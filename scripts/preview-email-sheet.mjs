// Build a single review page that embeds every rendered email as a live iframe.
//
// A press proof, not a gallery: each artefact sits on a light table with its
// brand chip, its file name and — the part that matters — WHAT THAT FIXTURE IS
// TESTING. A preview you cannot fail is not a proof.
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const require_ = createRequire(new URL('../functions/', import.meta.url))
const { shell, facts, lineTable, section, money } = require_('./emailTemplates.js')
const { venueBrand, platformBrand, orderTrackUrl } = require_('./emailBrand.js')

process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://rbt360sa.com'
const OUT = process.argv[2] || 'email-proof.html'

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// LOGO FIXTURES.
//
// Note these are data: URIs. They render inside an iframe srcdoc, so this sheet
// proves GEOMETRY — never delivery. Gmail blocks data: URIs in img src; only
// scripts/send-test-email.mjs with a hosted --logo can prove that half.
//
// Using our own /brand/mark-256.png here was misleading: it proved an image
// renders, not that a VENUE logo does, and it produced a "why is RBT360's logo
// on my venue's mail" report that was entirely the fixture's fault.
const svg = (w, h, body) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`, 'utf8').toString('base64')

// An opaque COLOURED square — corners visible against the plate.
const SQUARE_LOGO = svg(200, 200,
  '<rect width="200" height="200" fill="#C0262C"/>'
  + '<text x="100" y="138" font-size="104" font-family="sans-serif" fill="#ffffff" text-anchor="middle">م</text>')

// A WHITE-background square. THIS IS THE OWNER'S ACTUAL CASE and the only
// fixture in which the reported symptom appears: its corners fuse with the
// white disc, so an oversized image reads as a square bulging out of a circle
// rather than as four coloured spurs. Without this fixture the fix cannot be
// seen to work.
const WHITE_SQUARE = svg(200, 200,
  '<rect width="200" height="200" fill="#ffffff"/>'
  + '<circle cx="100" cy="100" r="62" fill="none" stroke="#7c2d2d" stroke-width="9"/>'
  + '<text x="100" y="132" font-size="76" font-family="sans-serif" fill="#7c2d2d" text-anchor="middle">م</text>')

// A WIDE wordmark. Proves the size cap did not reintroduce centre-cropping —
// it must letterbox inside the disc, never lose its ends.
const WIDE_WORDMARK = svg(400, 100,
  '<rect width="400" height="100" fill="#ffffff"/>'
  + '<text x="200" y="68" font-size="46" font-family="sans-serif" fill="#7c2d2d" text-anchor="middle">مزاج فال</text>')

// ALREADY MASKED: a circle on transparent, which is what logoMask.js and the
// fixed cropper now produce. The target state — it may fill the disc.
const ROUND_MASKED = svg(200, 200,
  '<circle cx="100" cy="100" r="100" fill="#ffffff"/>'
  + '<circle cx="100" cy="100" r="62" fill="none" stroke="#7c2d2d" stroke-width="9"/>'
  + '<text x="100" y="132" font-size="76" font-family="sans-serif" fill="#7c2d2d" text-anchor="middle">م</text>')

const LINES = [
  { name: 'سبانش لاتيه', qty: 2, total: money(30) },
  { name: 'تشيز كيك', qty: 1, total: money(22) },
  { name: 'كرواسون', qty: 1, total: money(12) },
]

const VENUES = [
  { key: 'mazaj', tests: 'منشأة كاملة: لون داكن وشعار وعنوان ورابط خرائط.', t: {
    name: 'كافيه مزاج فال', themeColor: '#7c2d2d', themeAccent: '#c8a15a',
    logoUrl: SQUARE_LOGO, slug: 'mazaj', phone: '0555000111',
    address: 'طريق الملك فهد، الرياض', vatNumber: '311111111100003',
    googleMapsUrl: 'https://maps.google.com/?cid=123' } },
  { key: 'lamsa', tests: 'لون فاتح. لو ظهر نصّ الترويسة أبيض هنا فاختيار الحبر مكسور — وهذا عطلٌ لا يُرى إلا داخل صندوق بريد.', t: {
    name: 'حلويات لمسة', themeColor: '#F0D48A', themeAccent: '#8A6A3F',
    logoUrl: '', slug: 'lamsa', phone: '0555222333', address: 'جدة', googleMapsUrl: '' } },
  { key: 'new', tests: 'منشأة في يومها الأول: بلا شعار ولا عنوان ولا رابط خرائط. لا يجب أن يظهر زرٌّ ميت ولا شريطٌ فارغ.', t: {
    name: 'مقهى جديد', slug: 'new' } },
]

const cards = []
const add = (title, note, brandHex, file, html) =>
  cards.push({ title, note, brandHex, file, html })

for (const v of VENUES) {
  const b = venueBrand(v.t)
  add(`${v.t.name} — استلمنا طلبك`, v.tests, b.color, `venue-${v.key}-accepted`, shell(b, {
    title: `${v.t.name} — قُبل طلبك`, preheader: `قُبل طلبك — ${v.t.name}`,
    body: `<p style="margin:0 0 12px;">مرحباً محمد,</p>
      <p style="margin:0 0 10px;font-size:15px;">استلمنا طلبك وبدأنا تجهيزه.</p>
      ${facts([['رقم الطلب', '1296'], ['الطاولة', 'طاولة 7']])}
      ${lineTable(LINES, 'الإجمالي', money(64))}`,
    cta: orderTrackUrl(v.t, 'abc123') ? { label: 'متابعة الطلب', href: orderTrackUrl(v.t, 'abc123') } : null,
  }))
  add(`${v.t.name} — الفاتورة وطلب التقييم`, 'لحظة الدفع: الفاتورة وزر «قيّمنا» على خرائط جوجل. الزر لا يُرسم إلا إذا وضعت المنشأة رابطاً.', b.color, `venue-${v.key}-paid`, shell(b, {
    title: `${v.t.name} — شكراً لك`, preheader: `فاتورتك — ${v.t.name}`,
    body: `<p style="margin:0 0 12px;">مرحباً محمد,</p>
      <p style="margin:0 0 10px;font-size:15px;">تم استلام دفعتك. نتمنى أن تكون قد استمتعت.</p>
      ${facts([['رقم الطلب', '1296'], ['المدفوع', money(64)]])}
      ${lineTable(LINES, 'الإجمالي', money(64))}`,
    cta: b.mapsUrl ? { label: 'قيّمنا على خرائط جوجل', href: b.mapsUrl } : null,
    secondaryCta: orderTrackUrl(v.t, 'abc123') ? { label: 'متابعة الطلب', href: orderTrackUrl(v.t, 'abc123') } : null,
  }))
}

const pb = platformBrand({})
add('RBT 360 — فاتورة اشتراك', 'بريدٌ منّا إلى المنشأة: هويتنا نحن، لا هوية المنشأة.', pb.color, 'platform-invoice', shell(pb, {
  title: 'فاتورة اشتراكك الشهري', preheader: 'فاتورة اشتراك RBT 360',
  body: `<p style="margin:0 0 12px;">مرحباً,</p>
    <p style="margin:0 0 10px;">صدرت فاتورة اشتراك «كافيه مزاج فال» عن الفترة الحالية.</p>
    ${facts([['رقم الفاتورة', 'INV-2026-000413'], ['الباقة', 'متكامل'], ['المبلغ', money(1033.85)], ['تستحق في', '2026-08-07']])}`,
  cta: { label: 'سداد الفاتورة', href: '#' },
}))
// THE LANGUAGE PAIR, ADJACENT.
//
// The report is the densest template — the most labels, the most places a
// string can be forgotten — so it is the one worth rendering twice. Adjacent is
// the whole point: a missed string is obvious beside its twin and nearly
// invisible when the two renders are read on separate pages.
for (const lg of ['ar', 'en']) {
  const p = (a, e) => (lg === 'en' ? e : a)
  const lb = platformBrand({}, lg)
  const m = (v) => money(v, 'SAR', { lang: lg })
  add(p('RBT 360 — التقرير اليومي (عربي)', 'RBT 360 — daily report (English)'),
    p('النسخة العربية. قارنها بجارتها: أي سطر بقي عربياً هناك هو سطرٌ نُسي.', 'The English render. Compare with its neighbour — any Arabic left there is a string nobody gave an English twin. Note the whole page also flips to LTR.'),
    lb.color, `platform-daily-${lg}`, shell(lb, {
      title: p('تقرير مبيعات كافيه مزاج فال — 2026-07-28', 'Sales report Mazaj Fal Cafe — 2026-07-28'),
      preheader: p('إيراد أمس 3420 ريال من 86 طلباً', 'Yesterday: 3420 SAR from 86 orders'),
      body: [
        `<p style="margin:0 0 6px;">${p('مرحباً,', 'Hello,')}</p>`,
        `<p style="margin:0 0 16px;color:#5c6270;font-size:13.5px;">${p('هذا تقرير مبيعات أمس لـ«كافيه مزاج فال»، مُجهَّز آلياً.', "Yesterday's sales for Mazaj Fal Cafe, prepared automatically.")}</p>`,
        section(lb, p('الحركة', 'Movement'), [
          [p('الطلبات المدفوعة', 'Paid orders'), '86'],
          [p('الطلبات الملغاة', 'Cancelled orders'), '3'],
          [p('متوسط قيمة الطلب', 'Average order value'), m(39)],
          [p('إجمالي الإيراد', 'Total revenue'), m(3420), 'strong'],
        ]),
        section(lb, p('الإيراد حسب طريقة الدفع', 'Revenue by payment method'), [
          [p('نقداً', 'Cash'), '31'], [p('شبكة', 'Card'), '42'], [p('أونلاين', 'Online'), '13'],
          [p('مجموع الطلبات المسوّاة', 'Settled orders'), '86', 'strong'],
        ]),
      ].join(''),
      cta: { label: p('فتح التقرير الكامل', 'Open the full report'), href: '#' },
    }))
}

add('RBT 360 — التقرير اليومي', 'أقسامٌ معنونة ومجاميع مميّزة: المالك يدقّق أرقام أمس مقابل توقّعه، لا يتصفّحها. الأرقام كانت محسوبة أصلاً وتُرسل واتساب فقط.', pb.color, 'platform-daily', shell(pb, {
  title: 'تقرير مبيعات كافيه مزاج فال — 2026-07-28',
  preheader: 'إيراد أمس 3420 ريال من 86 طلباً',
  body: [
    '<p style="margin:0 0 6px;">مرحباً,</p>',
    '<p style="margin:0 0 16px;color:#5c6270;font-size:13.5px;">هذا تقرير مبيعات أمس لـ«كافيه مزاج فال»، مُجهَّز آلياً.</p>',
    section(pb, 'الحركة', [
      ['الطلبات المدفوعة', '86'],
      ['الطلبات الملغاة', '3'],
      ['متوسط قيمة الطلب', money(39)],
      ['إجمالي الإيراد', money(3420), 'strong'],
    ]),
    section(pb, 'الإيراد حسب طريقة الدفع', [
      ['نقداً', '31'], ['شبكة', '42'], ['أونلاين', '13'],
      ['مجموع الطلبات المسوّاة', '86', 'strong'],
    ]),
    section(pb, 'الأكثر مبيعاً', [['سبانش لاتيه', '31'], ['موهيتو', '18'], ['تشيز كيك', '12']]),
    section(pb, 'أصناف تحتاج انتباهك', [['كرواسون لوز: بلا مبيعات هذا الأسبوع', '', 'muted']]),
  ].join(''),
  cta: { label: 'فتح التقرير الكامل', href: '#' },
}))

// THE LOGO LAB — the same masthead at 4x, over a ring drawn at the disc's exact
// edge. A 3.4px protrusion is a real defect and an unreliable human judgement at
// 1x; magnified it is 14px and unmissable. The scale lives on the PROOF stage,
// never in the email HTML.
const { header } = require_('./emailTemplates.js')
const LOGO_CASES = [
  ['WHITE_SQUARE — حالة المالك', WHITE_SQUARE, 'خلفية بيضاء: زواياها تندمج مع القرص الأبيض، فالبروز يُقرأ مربعاً لا أربعة نتوءات. لا يجب أن يتجاوز شيءٌ الحلقة.', false],
  ['SQUARE_LOGO — مربّع ملوّن', SQUARE_LOGO, 'نفس الهندسة بلون يفضح الزوايا مباشرة.', false],
  ['WIDE_WORDMARK — شعار عريض', WIDE_WORDMARK, 'يجب أن يظهر كاملاً بنسبته: أي قصٍّ هنا يعني أن object-fit عاد.', false],
  ['ROUND_MASKED — مفرّغ', ROUND_MASKED, 'الحالة الهدف: زوايا شفافة، فلا شيء يمكن أن يبرز — ويُسمح له بملء القرص.', true],
]
const logoLab = LOGO_CASES.map(([title, url, note, round]) => {
  const b = venueBrand({ name: 'كافيه مزاج فال', themeColor: '#7c2d2d', ...(round ? { logoRoundUrl: url } : { logoUrl: url }) })
  return { title, note, html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;">${header(b)}</table>` }
})

const page = `<style>
/* A press proof. The page is a light table and must stay silent — every colour
   on it belongs to an artefact being judged, not to the stage. Annotations are
   monospace because they are technical marks, not prose. */
:root{
  --ground:#EDEEF1; --sheet:#FFFFFF; --ink:#14161B; --muted:#6A7080;
  --rule:#D6D9E0; --mark:#9AA1B0; --chip-ring:rgba(0,0,0,.12);
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --sans:"IBM Plex Sans Arabic","Segoe UI",Tahoma,system-ui,sans-serif;
}
@media (prefers-color-scheme:dark){
  :root{--ground:#15171C;--sheet:#1C1F26;--ink:#E9EBF1;--muted:#8A91A1;
        --rule:#2B2F38;--mark:#666D7C;--chip-ring:rgba(255,255,255,.18);}
}
:root[data-theme="dark"]{--ground:#15171C;--sheet:#1C1F26;--ink:#E9EBF1;--muted:#8A91A1;
        --rule:#2B2F38;--mark:#666D7C;--chip-ring:rgba(255,255,255,.18);}
:root[data-theme="light"]{--ground:#EDEEF1;--sheet:#FFFFFF;--ink:#14161B;--muted:#6A7080;
        --rule:#D6D9E0;--mark:#9AA1B0;--chip-ring:rgba(0,0,0,.12);}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);line-height:1.75;}
.wrap{max-width:1240px;margin-inline:auto;padding:36px clamp(16px,4vw,32px) 72px;}
.brief{max-width:66ch;}
h1{font-size:clamp(1.4rem,3vw,1.9rem);font-weight:700;letter-spacing:-.015em;margin:0 0 6px;text-wrap:balance;}
.kicker{font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--mark);text-transform:uppercase;}
.brief p{color:var(--muted);font-size:.95rem;margin:10px 0 0;}
hr{border:0;border-top:1px solid var(--rule);margin:28px 0;}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:26px;}
.card{background:var(--sheet);border:1px solid var(--rule);border-radius:4px;overflow:hidden;display:flex;flex-direction:column;}
.cap{display:flex;align-items:center;gap:9px;padding:11px 13px;border-bottom:1px solid var(--rule);}
.chip{width:15px;height:15px;border-radius:3px;flex:none;box-shadow:inset 0 0 0 1px var(--chip-ring);}
.cap b{font-size:.9rem;font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cap code{margin-inline-start:auto;font-family:var(--mono);font-size:10.5px;color:var(--mark);flex:none;}
.note{padding:10px 13px;font-size:.8rem;color:var(--muted);line-height:1.7;border-bottom:1px solid var(--rule);}
.stage{background:#f2f3f5;padding:12px;}
iframe{width:100%;height:520px;border:0;border-radius:2px;background:#f2f3f5;display:block;}
.hex{font-family:var(--mono);font-size:10.5px;color:var(--mark);}
a:focus-visible,iframe:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
/* logo lab: 4x, with a ring at the disc's true edge as a reference for the eye */
.lab{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:26px;}
.lab .stage{padding:0;overflow:hidden;height:330px;position:relative;background:#fff;}
.lab .zoom{position:absolute;inset:0;transform:scale(4);transform-origin:50% 22%;}
.lab .ring{position:absolute;left:50%;top:22%;width:312px;height:312px;margin:-96px 0 0 -156px;
  border:1px dashed rgba(220,38,38,.75);border-radius:50%;pointer-events:none;}
.lab iframe{height:330px;}
</style>
<div class="wrap">
  <div class="brief">
    <div class="kicker">proof &middot; email templates</div>
    <h1>قوالب البريد — هويّتان، ومنشأةٌ تُلبَس تلقائياً</h1>
    <p>قالبٌ واحد يشتقّ هوية كل منشأة من مستندها: اللون والشعار والاسم وبيانات التذييل. منشأةٌ جديدة تصير مُهيّأة لحظة اختيارها لوناً في الإعداد — بلا قالبٍ لها، وبلا كود، وبلا نشر.</p>
    <p>وثلاث حالات هنا مختارة لأنها تكسر: منشأة كاملة، ومنشأة بلون <strong>فاتح</strong>، ومنشأة في يومها الأول بلا شعار ولا عنوان.</p>
  </div>
  <hr>
  <div class="grid">
    ${cards.map((c) => `
    <figure class="card" style="margin:0">
      <figcaption class="cap">
        <span class="chip" style="background:${esc(c.brandHex)}"></span>
        <b>${esc(c.title)}</b>
        <code>${esc(c.brandHex)}</code>
      </figcaption>
      <div class="note">${esc(c.note)}</div>
      <div class="stage"><iframe title="${esc(c.title)}" loading="lazy" srcdoc="${esc(c.html)}"></iframe></div>
    </figure>`).join('')}
  </div>

  <hr>
  <div class="brief">
    <div class="kicker">logo lab &middot; 4&times;</div>
    <h1>القرص، مكبَّراً</h1>
    <p>الشعار عند 60px كان يضع زواياه على بُعد <strong>42.4</strong> من المركز والقرص نصف قطره <strong>38</strong> — فتبرز 3.4 بكسل. وهذا حكمٌ لا تصدر عنه عينٌ بثقة عند الحجم الطبيعي، فهو هنا بأربعة أضعاف. الحلقة المتقطّعة هي حافة القرص الحقيقية: لا يجب أن يعبرها شيء.</p>
  </div>
  <div class="lab" style="margin-top:24px">
    ${logoLab.map((c) => `
    <figure class="card" style="margin:0">
      <figcaption class="cap"><b>${esc(c.title)}</b></figcaption>
      <div class="note">${esc(c.note)}</div>
      <div class="stage">
        <div class="zoom"><iframe title="${esc(c.title)}" loading="lazy" srcdoc="${esc(c.html)}"></iframe></div>
        <div class="ring"></div>
      </div>
    </figure>`).join('')}
  </div>
</div>`

mkdirSync(dirname(OUT) || '.', { recursive: true })
writeFileSync(OUT, page, 'utf8')
console.log(`email proof: ${cards.length} artefacts -> ${OUT}`)
