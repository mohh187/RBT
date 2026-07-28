// Render every email template to disk, without sending anything.
//
// WHY THIS EXISTS. Before it, there was no way to look at an email except to
// mail one to yourself — and that is precisely why the templates stayed as
// three bare <p> tags for so long. You cannot iterate on something you cannot
// see. This renders the whole set in both identities, including the cases that
// actually break layouts (a light brand colour, a venue with no logo, a long
// Arabic name, an order with many lines).
//
// Usage:  node scripts/preview-email.mjs [outDir]
// Then open the printed index.html.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const require_ = createRequire(new URL('../functions/', import.meta.url))
const { shell, facts, lineTable, esc } = require_('./emailTemplates.js')
const { venueBrand, platformBrand } = require_('./emailBrand.js')

const OUT = process.argv[2] || join(process.cwd(), 'email-preview')
mkdirSync(OUT, { recursive: true })

// PUBLIC_BASE_URL is what turns a relative logo path into something an inbox
// can fetch. Set it so the preview shows what production will show.
process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://rbt360sa.com'

// --- fixtures: the venues that break things -------------------------------
const VENUES = {
  dark: {
    name: 'كافيه مزاج فال', themeColor: '#7c2d2d', themeAccent: '#c8a15a',
    logoUrl: '/brand/mark-256.png', slug: 'mazaj', phone: '0555000111',
    address: 'طريق الملك فهد، الرياض', vatNumber: '311111111100003',
    googleMapsUrl: 'https://maps.google.com/?cid=123',
  },
  // The case that silently produces an unreadable header if onColor is skipped:
  // white text on a pale gold band.
  light: {
    name: 'حلويات لمسة', themeColor: '#F0D48A', themeAccent: '#8A6A3F',
    logoUrl: '', slug: 'lamsa', phone: '0555222333', address: 'جدة',
    googleMapsUrl: '',
  },
  // No logo, no address, no maps link — a venue on its first day.
  bare: { name: 'مقهى جديد', slug: 'new', themeColor: '', themeAccent: '' },
}

const LINES = [
  { name: 'سبانش لاتيه', qty: 2, total: '30.00' },
  { name: 'تشيز كيك', qty: 1, total: '22.00' },
  { name: 'كرواسون', qty: 1, total: '12.00' },
]

const pages = []
const emit = (file, title, html) => { writeFileSync(join(OUT, file), html, 'utf8'); pages.push([file, title]) }

// ---- venue -> guest ----
for (const [key, t] of Object.entries(VENUES)) {
  const brand = venueBrand(t)
  emit(`venue-${key}-accepted.html`, `${t.name} — استلمنا طلبك`, shell(brand, {
    title: `${t.name} — قُبل طلبك`,
    preheader: `قُبل طلبك — ${t.name}`,
    body: `<p style="margin:0 0 12px;">مرحباً محمد,</p>
      <p style="margin:0 0 10px;font-size:15px;">استلمنا طلبك وبدأنا تجهيزه.</p>
      ${facts([['رقم الطلب', '1296'], ['الطاولة', 'طاولة 7']])}
      ${lineTable(LINES, 'الإجمالي', '64.00 ريال')}`,
  }))
  emit(`venue-${key}-ready.html`, `${t.name} — جاهز`, shell(brand, {
    title: `${t.name} — طلبك جاهز`,
    preheader: `طلبك جاهز — ${t.name}`,
    body: `<p style="margin:0 0 12px;">مرحباً محمد,</p>
      <p style="margin:0 0 10px;font-size:15px;">طلبك جاهز للاستلام.</p>
      ${facts([['رقم الطلب', '1296']])}`,
  }))
  emit(`venue-${key}-paid.html`, `${t.name} — الفاتورة + قيّمنا`, shell(brand, {
    title: `${t.name} — شكراً لك`,
    preheader: `فاتورتك — ${t.name}`,
    body: `<p style="margin:0 0 12px;">مرحباً محمد,</p>
      <p style="margin:0 0 10px;font-size:15px;">تم استلام دفعتك. نتمنى أن تكون قد استمتعت.</p>
      ${facts([['رقم الطلب', '1296'], ['المدفوع', '64.00 ريال']])}
      ${lineTable(LINES, 'الإجمالي', '64.00 ريال')}`,
    cta: brand.mapsUrl ? { label: 'قيّمنا على خرائط جوجل', href: brand.mapsUrl } : null,
    secondaryCta: { label: 'عرض الفاتورة الضريبية', href: 'https://rbt360sa.com/invoice/x/y' },
  }))
}

// ---- platform -> venue owner ----
const pb = platformBrand({})
emit('platform-invoice.html', 'RBT360 — فاتورة اشتراك', shell(pb, {
  title: 'فاتورة اشتراكك الشهري',
  preheader: 'فاتورة اشتراك RBT 360',
  body: `<p style="margin:0 0 12px;">مرحباً,</p>
    <p style="margin:0 0 10px;">صدرت فاتورة اشتراك «كافيه مزاج فال» عن الفترة الحالية.</p>
    ${facts([['رقم الفاتورة', 'INV-2026-000413'], ['الباقة', 'متكامل'], ['المبلغ', '1033.85 ريال'], ['تستحق في', '2026-08-07']])}`,
  cta: { label: 'سداد الفاتورة', href: 'https://rbt360sa.com/admin/billing' },
}))
emit('platform-receipt.html', 'RBT360 — إيصال سداد', shell(pb, {
  title: 'استلمنا دفعتك',
  preheader: 'إيصال سداد الاشتراك',
  body: `<p style="margin:0 0 10px;">تم تفعيل باقتك حتى 2026-08-28.</p>
    ${facts([['المبلغ', '1033.85 ريال'], ['طريقة الدفع', 'مدى']])}`,
}))
emit('platform-daily.html', 'RBT360 — التقرير اليومي', shell(pb, {
  title: 'تقرير أمس — كافيه مزاج فال',
  preheader: 'مبيعات أمس وأبرز الأرقام',
  body: `${facts([
    ['المبيعات', '3,420 ريال'], ['عدد الطلبات', '86'],
    ['متوسط الفاتورة', '39.8 ريال'], ['الأكثر مبيعاً', 'سبانش لاتيه'],
  ])}`,
  cta: { label: 'فتح التقرير الكامل', href: 'https://rbt360sa.com/admin/daily-report' },
}))

// ---- index ----
const index = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>معاينة القوالب</title></head>
<body style="font-family:system-ui;background:#f2f3f5;margin:0;padding:24px;">
<h1 style="font-size:18px;">معاينة قوالب البريد</h1>
<p style="color:#555;font-size:14px;max-width:70ch;line-height:1.8;">
كل قالب مرسوم بهوية مشتقّة من مستند المنشأة. «light» منشأة بلون فاتح — إن ظهر
نصّ الترويسة أبيض عليه فذلك يعني أن اختيار الحبر انكسر. و«bare» منشأة بلا شعار
ولا عنوان ولا رابط خرائط: لا يجب أن يظهر فيها زرّ ميت ولا شريط فارغ.</p>
<ul style="line-height:2.2;font-size:15px;">
${pages.map(([f, t]) => `<li><a href="./${f}">${esc(t)}</a> <span style="color:#888;font-size:12px;">${f}</span></li>`).join('\n')}
</ul></body></html>`
writeFileSync(join(OUT, 'index.html'), index, 'utf8')

console.log(`preview-email: ${pages.length} templates -> ${join(OUT, 'index.html')}`)
