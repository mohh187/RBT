// Send the real templates to ONE address, through the real provider.
//
// The preview page proves the HTML is right. It cannot prove that Gmail keeps
// the layout, that the Arabic subject survives encoding, that the venue logo
// actually loads over the network, or that the sender name reads correctly in
// an inbox list. Only a real send does, and only in a real client.
//
// Usage: node scripts/send-test-email.mjs you@example.com [which] [--lang=ar,en] [--logo=URL]
//   which: all (default) | accepted | paid | report
//
// --lang takes a COMMA LIST and sends each language as its own message, because
// the thing being checked is a comparison: an Arabic and an English render of
// the same mail, sitting next to each other in one inbox. A missed string is
// obvious that way and nearly invisible when the two are read days apart.
//
// --logo takes an absolute URL. It must be HOSTED — Gmail blocks data: URIs in
// img src, so a local fixture proves nothing about delivery.
//
// HOW TO ACTUALLY CHECK THE RTL FIX: open the message in Gmail WEB and inspect
// the DOM. "Show original" returns the raw MIME, which always contains our dir
// attribute and therefore proves nothing — the whole defect was that Gmail
// STRIPS the node it used to be on. Then check the Gmail mobile app separately
// (a different sanitiser) and Outlook, which is where a WebP logo will fail.
//
// SAFETY: refuses to run without an explicit recipient argument. This script
// talks to the production Resend account with the production key — it must
// never be possible to run it and have it guess who to mail.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require_ = createRequire(new URL('../functions/', import.meta.url))
const { shell, facts, lineTable, section, money } = require_('./emailTemplates.js')
const { venueBrand, platformBrand, orderTrackUrl } = require_('./emailBrand.js')
const { L } = require_('./emailLang.js')

const ARGV = process.argv.slice(2)
const flag = (name, dflt) => {
  const hit = ARGV.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const POS = ARGV.filter((a) => !a.startsWith('--'))
const TO = POS[0]
const WHICH = (POS[1] || 'all').toLowerCase()
const LANGS = flag('lang', 'ar,en').split(',').map((x) => x.trim()).filter(Boolean)
const LOGO = flag('logo', '')
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
// display, the platform's verified domain in the address, and «عبر»/«via»
// following the reader's language (it sits in the inbox list next to the
// subject, so an Arabic word in an otherwise English row reads as a bug).
const brandedFrom = (name, lang) => {
  if (!name) return FROM
  const addr = (FROM.match(/<([^>]+)>/) || [])[1] || FROM
  const clean = String(name).replace(/[\r\n<>"]/g, '').trim().slice(0, 60)
  return clean ? `${clean} ${L(lang)('عبر', 'via')} rbt360 <${addr}>` : FROM
}

const VENUE = {
  name: 'كافيه مزاج فال',
  themeColor: '#7c2d2d', themeAccent: '#c8a15a',
  // Pass a REAL venue logo URL with --logo. Defaults to none, which is the
  // honest fallback path — our own mark here would just be a lie, and passing
  // it once already produced a "why is RBT360's logo on my venue's mail" report.
  logoUrl: LOGO, slug: 'mazaj',
  phone: '0555000111', address: 'طريق الملك فهد، الرياض',
  vatNumber: '311111111100003',
  googleMapsUrl: 'https://maps.google.com/?cid=1234567890',
}

const track = orderTrackUrl(VENUE, 'demo-order-1296')

function build(lang) {
  const p = L(lang)
  const vb = venueBrand(VENUE, lang)
  const pb = platformBrand({}, lang)
  const m = (v) => money(v, 'SAR', { lang })
  const venueName = p(VENUE.name, 'Mazaj Fal Cafe')
  const lines = [
    { name: p('سبانش لاتيه', 'Spanish Latte'), qty: 2, total: m(30) },
    { name: p('تشيز كيك', 'Cheesecake'), qty: 1, total: m(22) },
    { name: p('كرواسون', 'Croissant'), qty: 1, total: m(12) },
  ]
  return {
    accepted: {
      fromName: venueName,
      subject: `${venueName} — ${p('قُبل طلبك', 'your order is accepted')} #1296`,
      html: shell(vb, {
        title: `${venueName} — ${p('قُبل طلبك', 'Your order is accepted')}`,
        preheader: p('استلمنا طلبك وبدأنا تجهيزه', 'We have your order and started preparing it'),
        body: `<p style="margin:0 0 12px;">${p('مرحباً محمد,', 'Hello Mohammed,')}</p>
          <p style="margin:0 0 10px;font-size:15px;">${p('استلمنا طلبك وبدأنا تجهيزه.', 'We have your order and started preparing it.')}</p>
          ${facts([[p('رقم الطلب', 'Order number'), '1296'], [p('الطاولة', 'Table'), p('طاولة 7', 'Table 7')]], { dir: vb.dir })}
          ${lineTable(lines, p('الإجمالي', 'Total'), m(64), { dir: vb.dir })}`,
        cta: track ? { label: p('متابعة الطلب', 'Track order'), href: track } : null,
      }),
    },
    paid: {
      fromName: venueName,
      subject: `${venueName} — ${p('شكراً لك، فاتورتك', 'thank you, your invoice')} #1296`,
      html: shell(vb, {
        title: `${venueName} — ${p('شكراً لك', 'Thank you')}`,
        preheader: p('تم استلام دفعتك — فاتورتك بالداخل', 'Payment received — your invoice is inside'),
        body: `<p style="margin:0 0 12px;">${p('مرحباً محمد,', 'Hello Mohammed,')}</p>
          <p style="margin:0 0 10px;font-size:15px;">${p('تم استلام دفعتك. نتمنى أن تكون قد استمتعت.', 'Your payment was received. We hope you enjoyed it.')}</p>
          ${facts([[p('رقم الطلب', 'Order number'), '1296'], [p('المدفوع', 'Paid'), m(64)]], { dir: vb.dir })}
          ${lineTable(lines, p('الإجمالي', 'Total'), m(64), { dir: vb.dir })}`,
        cta: { label: p('قيّمنا على خرائط جوجل', 'Rate us on Google Maps'), href: VENUE.googleMapsUrl },
        secondaryCta: track ? { label: p('متابعة الطلب', 'Track order'), href: track } : null,
      }),
    },
    report: {
      fromName: '',
      subject: p(`تقرير مبيعات ${VENUE.name} — 2026-07-28`, `Sales report ${venueName} — 2026-07-28`),
      html: shell(pb, {
        title: p(`تقرير مبيعات ${VENUE.name} — 2026-07-28`, `Sales report ${venueName} — 2026-07-28`),
        preheader: p('إيراد أمس 3420 ريال من 86 طلباً', 'Yesterday: 3420 SAR from 86 orders'),
        body: [
          `<p style="margin:0 0 6px;">${p('مرحباً,', 'Hello,')}</p>`,
          `<p style="margin:0 0 16px;color:#5c6270;font-size:13.5px;">${p(`هذا تقرير مبيعات أمس لـ«${VENUE.name}»، مُجهَّز آلياً.`, `Yesterday's sales for ${venueName}, prepared automatically.`)}</p>`,
          section(pb, p('الحركة', 'Movement'), [
            [p('الطلبات المدفوعة', 'Paid orders'), '86'],
            [p('الطلبات الملغاة', 'Cancelled orders'), '3'],
            [p('متوسط قيمة الطلب', 'Average order value'), m(39)],
            [p('إجمالي الإيراد', 'Total revenue'), m(3420), 'strong'],
          ]),
          section(pb, p('الإيراد حسب طريقة الدفع', 'Revenue by payment method'), [
            [p('نقداً', 'Cash'), '31'], [p('شبكة', 'Card'), '42'], [p('أونلاين', 'Online'), '13'],
            [p('مجموع الطلبات المسوّاة', 'Settled orders'), '86', 'strong'],
          ]),
          section(pb, p('الأكثر مبيعاً', 'Best sellers'), [
            [p('سبانش لاتيه', 'Spanish Latte'), '31'], [p('موهيتو', 'Mojito'), '18'], [p('تشيز كيك', 'Cheesecake'), '12'],
          ]),
          section(pb, p('أصناف تحتاج انتباهك', 'Items needing attention'), [
            [p('كرواسون لوز: بلا مبيعات هذا الأسبوع', 'Almond croissant: no sales this week'), '', 'muted'],
          ]),
        ].join(''),
        cta: { label: p('فتح التقرير الكامل', 'Open the full report'), href: process.env.PUBLIC_BASE_URL + '/admin/daily-report' },
      }),
    },
  }
}

for (const lang of LANGS) {
  const MAILS = build(lang)
  const pick = WHICH === 'all' ? Object.keys(MAILS) : [WHICH]
  for (const k of pick) {
    const mail = MAILS[k]
    if (!mail) { console.error(`unknown template: ${k}`); process.exitCode = 1; continue }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ from: brandedFrom(mail.fromName, lang), to: [TO], subject: mail.subject, html: mail.html }),
    })
    const body = await res.json().catch(() => ({}))
    console.log(res.ok
      ? `sent  ${lang}  ${k.padEnd(9)} -> ${TO}   id ${body.id || '-'}`
      : `FAIL  ${lang}  ${k.padEnd(9)} -> ${res.status} ${JSON.stringify(body).slice(0, 200)}`)
  }
}
