// Send the real templates to ONE address, through the real provider.
//
// The preview page proves the HTML is right. It cannot prove that Gmail keeps
// the layout, that the Arabic subject survives encoding, that the venue logo
// actually loads over the network, or that the sender name reads correctly in
// an inbox list. Only a real send does, and only in a real client.
//
// Usage: node scripts/send-test-email.mjs you@example.com [which]
//   which: all (default) | accepted | paid | report
//
// SAFETY: refuses to run without an explicit recipient argument. This script
// talks to the production Resend account with the production key — it must
// never be possible to run it and have it guess who to mail.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require_ = createRequire(new URL('../functions/', import.meta.url))
const { shell, facts, lineTable, section, money } = require_('./emailTemplates.js')
const { venueBrand, platformBrand, orderTrackUrl } = require_('./emailBrand.js')

const TO = process.argv[2]
const WHICH = (process.argv[3] || 'all').toLowerCase()
if (!TO || !TO.includes('@')) {
  console.error('refusing to send: pass a recipient.\n  node scripts/send-test-email.mjs you@example.com')
  process.exit(1)
}

// Read the same env the deployed functions use.
const env = Object.fromEntries(
  readFileSync(new URL('../functions/.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const KEY = env.RESEND_API_KEY
const FROM = env.EMAIL_FROM || 'RBT360 <onboarding@resend.dev>'
process.env.PUBLIC_BASE_URL = env.PUBLIC_BASE_URL || 'https://rbt360sa.com'
if (!KEY) { console.error('RESEND_API_KEY missing in functions/.env'); process.exit(1) }

// Mirrors brandedFrom() in functions/messaging.js — the venue's name in the
// display, the platform's verified domain in the address.
const brandedFrom = (name) => {
  if (!name) return FROM
  const addr = (FROM.match(/<([^>]+)>/) || [])[1] || FROM
  const clean = String(name).replace(/[\r\n<>"]/g, '').trim().slice(0, 60)
  return clean ? `${clean} عبر rbt360 <${addr}>` : FROM
}

const VENUE = {
  name: 'كافيه مزاج فال',
  themeColor: '#7c2d2d', themeAccent: '#c8a15a',
  // Pass a REAL venue logo URL as argv[4] to see it. Defaults to none, which is
  // the honest fallback path — our own mark here would just be a lie.
  logoUrl: process.argv[4] || '', slug: 'mazaj',
  phone: '0555000111', address: 'طريق الملك فهد، الرياض',
  vatNumber: '311111111100003',
  googleMapsUrl: 'https://maps.google.com/?cid=1234567890',
}
const LINES = [
  { name: 'سبانش لاتيه', qty: 2, total: money(30) },
  { name: 'تشيز كيك', qty: 1, total: money(22) },
  { name: 'كرواسون', qty: 1, total: money(12) },
]

const vb = venueBrand(VENUE)
const pb = platformBrand({})
const track = orderTrackUrl(VENUE, 'demo-order-1296')

const MAILS = {
  accepted: {
    fromName: VENUE.name,
    subject: `${VENUE.name} — قُبل طلبك #1296`,
    html: shell(vb, {
      title: `${VENUE.name} — قُبل طلبك`,
      preheader: 'استلمنا طلبك وبدأنا تجهيزه',
      body: `<p style="margin:0 0 12px;">مرحباً محمد,</p>
        <p style="margin:0 0 10px;font-size:15px;">استلمنا طلبك وبدأنا تجهيزه.</p>
        ${facts([['رقم الطلب', '1296'], ['الطاولة', 'طاولة 7']])}
        ${lineTable(LINES, 'الإجمالي', money(64))}`,
      cta: track ? { label: 'متابعة الطلب', href: track } : null,
    }),
  },
  paid: {
    fromName: VENUE.name,
    subject: `${VENUE.name} — شكراً لك، فاتورتك #1296`,
    html: shell(vb, {
      title: `${VENUE.name} — شكراً لك`,
      preheader: 'تم استلام دفعتك — فاتورتك بالداخل',
      body: `<p style="margin:0 0 12px;">مرحباً محمد,</p>
        <p style="margin:0 0 10px;font-size:15px;">تم استلام دفعتك. نتمنى أن تكون قد استمتعت.</p>
        ${facts([['رقم الطلب', '1296'], ['المدفوع', money(64)]])}
        ${lineTable(LINES, 'الإجمالي', money(64))}`,
      cta: { label: 'قيّمنا على خرائط جوجل', href: VENUE.googleMapsUrl },
      secondaryCta: track ? { label: 'متابعة الطلب', href: track } : null,
    }),
  },
  report: {
    fromName: '',
    subject: `تقرير مبيعات ${VENUE.name} — 2026-07-28`,
    html: shell(pb, {
      title: `تقرير مبيعات ${VENUE.name} — 2026-07-28`,
      preheader: 'إيراد أمس 3420 ريال من 86 طلباً',
      body: [
        '<p style="margin:0 0 6px;">مرحباً,</p>',
        `<p style="margin:0 0 16px;color:#5c6270;font-size:13.5px;">هذا تقرير مبيعات أمس لـ«${VENUE.name}»، مُجهَّز آلياً.</p>`,
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
      cta: { label: 'فتح التقرير الكامل', href: process.env.PUBLIC_BASE_URL + '/admin/daily-report' },
    }),
  },
}

const pick = WHICH === 'all' ? Object.keys(MAILS) : [WHICH]
for (const k of pick) {
  const m = MAILS[k]
  if (!m) { console.error(`unknown template: ${k}`); process.exitCode = 1; continue }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ from: brandedFrom(m.fromName), to: [TO], subject: m.subject, html: m.html }),
  })
  const body = await res.json().catch(() => ({}))
  console.log(res.ok
    ? `sent  ${k.padEnd(9)} -> ${TO}   id ${body.id || '-'}`
    : `FAIL  ${k.padEnd(9)} -> ${res.status} ${JSON.stringify(body).slice(0, 200)}`)
}
