// ============ Customer & venue messaging: Email (Resend) + WhatsApp (Meta) ============
// - Email via Resend (RESEND_API_KEY) — transactional emails (welcome, receipts).
// - WhatsApp via Meta Cloud API (WA_PHONE_NUMBER_ID + WA_ACCESS_TOKEN) — order
//   status updates delivered to the CUSTOMER's WhatsApp (not just the menu page).
// Both fail-soft: if the provider env is unset, the send is skipped (no crash).
// Only the TRIGGERS are registered as Cloud Functions (in index.js); the send
// helpers are required by other function files.
const { onDocumentUpdated, onDocumentCreated } = require('firebase-functions/v2/firestore')
const { getFirestore } = require('firebase-admin/firestore')
const { shell, facts, lineTable } = require('./emailTemplates.js')
const { venueBrand, platformBrand, orderTrackUrl } = require('./emailBrand.js')
const { normLang, L, pickName } = require('./emailLang.js')
const { takeSpend } = require('./spend')

// ------------------------- the meter, in one place -------------------------
// Every send helper below takes a `meter` argument, and it is the ONLY thing
// standing between a trigger loop and the platform's Meta/Resend bill. Three
// shapes are accepted so that the reason a send is allowed is always written
// down at the call site rather than assumed:
//
//   { db, tid, channel, tenant? }  — meter it here, now
//   'claimed'                      — the caller already claimed the budget
//                                    upstream (campaigns take their whole
//                                    audience in one grant before fanning out)
//   'platform'                     — genuinely not a venue's spend: the venue
//                                    welcome mail, a staff invite. Rare, and
//                                    named so it can be audited.
//
// Anything else — including forgetting the argument — sends, but says so in
// the logs. Sending is never blocked by a bookkeeping mistake; an unmetered
// path just cannot hide.
async function claim(meter, kind) {
  if (meter === 'claimed' || meter === 'platform') return true
  if (meter && meter.db && meter.tid && meter.channel) {
    const r = await takeSpend(meter.db, meter.tid, meter.channel, 1, { tenant: meter.tenant })
    if (r.granted < 1) {
      console.warn(`[spend] refused ${meter.channel} for ${meter.tid}: ${r.reason}`)
      return false
    }
    return true
  }
  console.warn(`[spend] UNMETERED ${kind} send — no meter passed`)
  return true
}

// ---------------------------- Email (Resend) ----------------------------
// fromName brands the sender per venue: «مقهى مزاج عبر rbt360 <no-reply@rbt360sa.com>»
// — the address stays the platform's verified domain (Resend requirement), only the
// display name carries the venue identity. replyTo can be the venue's real inbox.
function brandedFrom(fromName, lang) {
  const base = process.env.EMAIL_FROM || 'RBT360 <onboarding@resend.dev>'
  if (!fromName) return base
  const addr = (base.match(/<([^>]+)>/) || [])[1] || base
  const clean = String(fromName).replace(/[\r\n<>"]/g, '').trim().slice(0, 60)
  // The sender name sits in the inbox list next to the subject; an Arabic «عبر»
  // in an otherwise English row is the first thing that looks wrong.
  return clean ? `${clean} ${L(lang)('عبر', 'via')} rbt360 <${addr}>` : base
}
async function sendEmail({ to, subject, html, replyTo, fromName, lang, meter }) {
  const key = process.env.RESEND_API_KEY
  if (!key || !to || !subject) return { ok: false, skipped: true }
  if (!(await claim(meter, 'email'))) return { ok: false, skipped: true, limited: true }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      // charset stated explicitly: Arabic subjects and bodies must not be left
      // to the receiver's guess.
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ from: brandedFrom(fromName, lang), to: Array.isArray(to) ? to : [to], subject, html, reply_to: replyTo || undefined }),
    })
    return { ok: r.ok, status: r.status }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'send failed' }
  }
}

// HTML-escape a user-controlled value before interpolating into email HTML.
// (Venue name, order code, staff role, etc. are attacker-influenced; without this
// a crafted venue name could inject phishing markup into a signed rbt360 email.)
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Arabic-first transactional shell. Signature is unchanged so every existing
// caller keeps working.
//
// Written against real email-client constraints, not browser ones:
//   - <meta charset="utf-8"> in a real <head>. Without it some clients guess the
//     encoding and Arabic arrives as "??????".
//   - TABLE layout with inline styles. Outlook (Word engine) ignores flexbox,
//     grid and most <style> blocks; tables are the only reliably centred layout.
//   - System font stack that actually contains Arabic faces — web fonts are
//     commonly blocked, and a missing Arabic face is what produces tofu boxes.
//   - A hidden preheader, so the inbox preview line is a real sentence instead
//     of scraping the first words of the body.
//   - Readable contrast (the old footer gray was ~2.8:1 and vanished).
function emailShell(title, bodyHtml, preheader) {
  const pre = String(preheader || '').replace(/[<>]/g, '')
  return `<!doctype html>
<html dir="rtl" lang="ar" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f2f3f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${pre}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f3f5;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e3e4e8;border-radius:16px;overflow:hidden;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
      <tr><td style="height:4px;background:#7c2d2d;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:28px 28px 8px;" align="right">
        <h1 style="margin:0;font-size:20px;line-height:1.45;font-weight:700;color:#14151a;">${title}</h1>
      </td></tr>
      <tr><td style="padding:4px 28px 28px;color:#3f434d;font-size:15px;line-height:1.8;" align="right">
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #eceef1;background:#fafbfc;" align="center">
        <div style="font-size:12px;color:#5c6270;letter-spacing:.3px;">RBT360</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

// ---------------------------- WhatsApp (Meta Cloud API) ----------------------------
// Normalize a Saudi/local phone to an E.164-ish msisdn (digits only, no +).
function normalizeMsisdn(phone, defaultCC = '966') {
  let d = String(phone || '').replace(/[^0-9]/g, '')
  if (!d) return ''
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('0')) return defaultCC + d.slice(1) // 05xxxxxxxx -> 9665xxxxxxxx
  if (d.length === 9 && d.startsWith('5')) return defaultCC + d // 5xxxxxxxx -> 9665xxxxxxxx
  return d
}
// Per-venue WhatsApp sender. A venue may connect its OWN Meta number so messages
// arrive from ITS name/number instead of the platform's. Credentials live in
// tenants/{tid}/private/wa (NOT on the public tenant doc — it is world-readable):
//   { phoneNumberId, accessToken, templateOrderUpdate?, templateReceipt? }
// Fail-soft: missing/invalid → platform env credentials.
async function waCredsFor(db, tid) {
  if (!db || !tid) return null
  try {
    const s = await db.doc(`tenants/${tid}/private/wa`).get()
    const d = s.exists ? s.data() : null
    if (d && d.phoneNumberId && d.accessToken) return { phoneId: String(d.phoneNumberId), token: String(d.accessToken), templates: d }
  } catch (_) { /* fall back to platform creds */ }
  return null
}

// Business-initiated messages to a customer (outside a 24h session) MUST use an
// APPROVED utility template. bodyParams fill the template's {{1}},{{2}},… vars.
// creds (optional) = { phoneId, token } from waCredsFor → send as the venue itself.
async function sendWhatsAppTemplate(to, templateName, langCode, bodyParams, creds, meter) {
  const token = (creds && creds.token) || process.env.WA_ACCESS_TOKEN
  const phoneId = (creds && creds.phoneId) || process.env.WA_PHONE_NUMBER_ID
  const msisdn = normalizeMsisdn(to)
  if (!token || !phoneId || !templateName || !msisdn) return { ok: false, skipped: true }
  if (!(await claim(meter, 'whatsapp-template'))) return { ok: false, skipped: true, limited: true }
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: msisdn, type: 'template',
        template: {
          name: templateName,
          language: { code: langCode || process.env.WA_LANG || 'ar' },
          components: (bodyParams && bodyParams.length)
            ? [{ type: 'body', parameters: bodyParams.map((t) => ({ type: 'text', text: String(t) })) }]
            : undefined,
        },
      }),
    })
    return { ok: r.ok, status: r.status }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'wa failed' }
  }
}
// Free-form text — only delivered inside the 24h customer-service window (dev/fallback).
// creds (optional) = { phoneId, token } → send from the venue's own number.
async function sendWhatsAppText(to, text, creds, meter) {
  const token = (creds && creds.token) || process.env.WA_ACCESS_TOKEN
  const phoneId = (creds && creds.phoneId) || process.env.WA_PHONE_NUMBER_ID
  const msisdn = normalizeMsisdn(to)
  if (!token || !phoneId || !msisdn) return { ok: false, skipped: true }
  if (!(await claim(meter, 'whatsapp-text'))) return { ok: false, skipped: true, limited: true }
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: msisdn, type: 'text', text: { body: String(text).slice(0, 900) } }),
    })
    return { ok: r.ok, status: r.status }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'wa failed' }
  }
}

const STATUS_AR = {
  accepted: 'تم قبول طلبك', preparing: 'جارٍ تحضير طلبك', ready: 'طلبك جاهز',
  served: 'تم تقديم طلبك', paid: 'تم استلام الدفع', cancelled: 'تم إلغاء طلبك', refunded: 'تم استرجاع مبلغ طلبك',
}
// KEPT SEPARATE FROM STATUS_AR ON PURPOSE.
//
// STATUS_AR feeds the WhatsApp template parameter as well as the email. A
// WhatsApp template is APPROVED BY META IN ONE LANGUAGE; interpolating an
// English word into a body approved in Arabic is how a venue's order
// notifications start failing silently. So the WhatsApp path keeps using
// STATUS_AR unconditionally, and only the email reads this.
const STATUS_EN = {
  accepted: 'Your order is accepted', preparing: 'Your order is being prepared', ready: 'Your order is ready',
  served: 'Your order has been served', paid: 'Payment received', cancelled: 'Your order was cancelled', refunded: 'Your order has been refunded',
}
// 'paid' is the thank-you moment: the guest has finished and settled, so the
// message that fires there says thank you, asks for a rating and hands them the
// venue's Google Maps link (tenant.googleMapsUrl) — not just a status line.
const NOTIFY_STATUSES = ['accepted', 'preparing', 'ready', 'served', 'paid', 'cancelled', 'refunded']

// WHICH STAGES ACTUALLY REACH THE GUEST — and who decides.
//
// Every one of the seven statuses above used to send. A guest ordering a coffee
// received: accepted, preparing, ready, served, paid. Five emails and five
// WhatsApp messages for one cup. That is not a notification system, it is a
// mailing list nobody subscribed to, and it burns the venue's metered WhatsApp
// budget on messages that annoy the person paying for them.
//
// So the venue chooses. These are only the DEFAULTS, and they are deliberately
// conservative — the three moments a guest actually wants:
//   accepted  «we have your order»
//   ready     «come and get it»
//   paid      the receipt, and the moment to ask for a rating
// plus the two they must never miss: cancelled and refunded.
// «preparing» and «served» tell the guest nothing they cannot see, so they are
// off unless a venue turns them on.
const NOTIFY_STAGE_DEFAULTS = {
  accepted: { email: true, whatsapp: true },
  preparing: { email: false, whatsapp: false },
  ready: { email: true, whatsapp: true },
  served: { email: false, whatsapp: false },
  paid: { email: true, whatsapp: true },
  cancelled: { email: true, whatsapp: true },
  refunded: { email: true, whatsapp: true },
}

// Resolve one stage/channel against the venue's settings.
// The old master switches (customerNotify.email / .whatsapp) still win when set
// to false — turning a channel off entirely must stay one click, and a venue
// that already switched one off must not have it switched back on by this.
function stageAllows(tenant, status, channel) {
  const cn = (tenant && tenant.customerNotify) || {}
  if (cn[channel] === false) return false
  const stage = (cn.stages && cn.stages[status]) || {}
  if (typeof stage[channel] === 'boolean') return stage[channel]
  const def = NOTIFY_STAGE_DEFAULTS[status]
  return def ? def[channel] !== false : false
}

// A WhatsApp template parameter. Meta REJECTS the whole message when a parameter
// is empty or contains a newline/tab, so every value is collapsed to one line
// and can never come back empty — an order placed without a name must not cost
// the customer their notification.
function waParam(v, fallback = '-') {
  const s = String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  return s || fallback
}

// Money the way a guest reads it: Latin digits, two decimals, currency named in
// Arabic. (Arabic-Indic numerals are a hard project rule against.)
// PLAIN TEXT money — for WhatsApp, which cannot render the riyal mark image.
// `lang` is optional and defaults to Arabic so the WhatsApp path, which is
// always Arabic (its templates are approved that way), keeps its exact wording.
function money(n, currency, lang) {
  const v = Number(n)
  const num = Number.isFinite(v) ? v.toFixed(2) : '0.00'
  const cur = String(currency || 'SAR').toUpperCase()
  if (cur !== 'SAR') return `${num} ${cur}`
  return normLang(lang) === 'en' ? `SAR ${num}` : `${num} ريال`
}

// The order, said briefly. Returns at most `max` lines plus a "+N more" line, so
// a twenty-item order does not turn a status notice into a wall of text.
function orderLines(order, max = 6) {
  const items = Array.isArray(order && order.items) ? order.items : []
  const shown = items.slice(0, max).map((l) => ({
    name: String(l.nameAr || l.nameEn || '').trim() || 'صنف',
    qty: Number(l.qty) || 1,
    total: Number(l.lineTotal != null ? l.lineTotal : (Number(l.unitPrice) || 0) * (Number(l.qty) || 1)),
  }))
  return { shown, hidden: Math.max(0, items.length - shown.length), count: items.length }
}

// TRIGGER: when a customer's order changes status, message them on WhatsApp (and
// email if their email is on the order). The customer gave their phone at order
// time (implied consent for order updates). Venue can disable via customerNotify.
const onOrderCustomerNotify = onDocumentUpdated('tenants/{tid}/orders/{oid}', async (event) => {
  const before = event.data && event.data.before.data()
  const after = event.data && event.data.after.data()
  if (!before || !after || before.status === after.status) return
  if (!NOTIFY_STATUSES.includes(after.status)) return
  const phone = after.customerPhone
  const email = after.customerEmail
  if (!phone && !email) return

  const db = getFirestore()
  const tSnap = await db.doc(`tenants/${event.params.tid}`).get().catch(() => null)
  const tenant = (tSnap && tSnap.exists) ? tSnap.data() : {}
  const ch = tenant.customerNotify || {}
  const venueName = tenant.name || 'متجرك'
  const code = after.code ? '#' + after.code : ''
  const statusText = STATUS_AR[after.status] || after.status
  // Venue-branded sending: own WhatsApp number (if connected) + custom text template.
  const creds = await waCredsFor(db, event.params.tid)
  // TEMPLATE LANGUAGE is a property of the TEMPLATE, not of the venue's UI.
  // Meta rejects a send whose language code is not one the template was approved
  // in, so a venue running an Arabic UI whose template was approved in en_US (or
  // the reverse) would have every message silently fail. The language configured
  // ALONGSIDE the template name therefore wins; the UI locale is a last resort.
  // Declared AFTER `creds` on purpose — reading it above would be a temporal
  // dead zone reference and would throw on every order update.
  const lang = (creds && creds.templates && creds.templates.templateLang)
    || process.env.WA_LANG
    || tenant.locale
    || 'ar'
  const fillTpl = (s) => String(s || '')
    .replace(/\{venue\}|\{المنشأة\}/g, venueName)
    .replace(/\{code\}|\{الطلب\}/g, code || '-')
    .replace(/\{status\}|\{الحالة\}/g, statusText)
  const customText = (tenant.msgTemplates && tenant.msgTemplates.orderStatus) || ''

  // Who the message is FOR. A guest may order without giving a name, so there is
  // always a polite fallback rather than an empty greeting.
  const customerName = waParam(after.customerName, 'عميلنا العزيز')
  const totalText = money(after.total, after.currency)
  const { shown, hidden, count } = orderLines(after)

  // THE THANK-YOU MOMENT. On 'paid' the guest is done: thank them by name, ask
  // for a rating, and hand them the venue's Google Maps link if the venue set
  // one (tenant.googleMapsUrl — the settings screen's «رابط خرائط جوجل»).
  // msgTemplates.thankYou lets the venue write its own words.
  const isPaid = after.status === 'paid'
  const mapsUrl = /^https?:\/\//.test(String(tenant.googleMapsUrl || '')) ? String(tenant.googleMapsUrl).trim() : ''
  const thankText = (tenant.msgTemplates && tenant.msgTemplates.thankYou)
    ? fillTpl(tenant.msgTemplates.thankYou)
    : `شكراً لك${after.customerName ? ` يا ${customerName}` : ''} على زيارتك لـ${venueName}. سعدنا بخدمتك، ونتمنى أن يكون كل شيء نال رضاك.`
  const rateLine = mapsUrl
    ? `يسعدنا تقييمك لنا على خرائط جوجل: ${mapsUrl}`
    : 'يسعدنا سماع رأيك في زيارتك القادمة.'

  // Transactional WhatsApp/email for THIS venue. Until the meter existed these
  // two channels were the platform's uncapped exposure: one order-update loop
  // meant unbounded Meta charges with nothing to stop it.
  const waMeter = { db, tid: event.params.tid, channel: 'waUtility', tenant }
  const mailMeter = { db, tid: event.params.tid, channel: 'email', tenant }

  // Same per-stage control as the email above. WhatsApp matters MORE here: it
  // is the venue's most expensive metered channel, so a status nobody needs is
  // money spent on annoying the guest.
  if (phone && stageAllows(tenant, after.status, 'whatsapp')) {
    // Venue's own approved template name wins; else the platform template.
    const tmpl = (creds && creds.templates && creds.templates.templateOrderUpdate) || process.env.WA_TEMPLATE_ORDER_UPDATE
    if (tmpl) {
      // The PARAMETER COUNT must match the template exactly or Meta rejects the
      // whole message, so it is chosen by which template is configured rather
      // than assumed. Ours greets the customer and carries the order; the Meta
      // sample templates used while setting up take the older three.
      const ours = /^rbt360_order_status/.test(String(tmpl))
      const params = ours
        ? [customerName, waParam(venueName), waParam(code, '-'), waParam(statusText), waParam(totalText)]
        : [waParam(venueName), waParam(code, '-'), waParam(statusText)]
      await sendWhatsAppTemplate(phone, tmpl, lang, params, creds, waMeter).catch(() => {})
      // the thank-you words cannot ride inside an approved template's fixed
      // body, so they follow as a free-form line (delivered inside the 24h
      // service window; best effort, never blocks the status template)
      if (isPaid) await sendWhatsAppText(phone, `${thankText}\n${rateLine}`, creds, waMeter).catch(() => {})
    } else {
      // No approved template configured yet → best-effort free-form (24h window only).
      const lines = [
        `مرحباً ${customerName}`,
        '',
        `طلبك لدى ${venueName}`,
        `رقم الطلب: ${code || '-'}`,
        `الحالة: ${statusText}`,
        `الإجمالي: ${totalText}`,
        ...(isPaid ? ['', thankText, rateLine] : []),
      ].join('\n')
      await sendWhatsAppText(phone, customText ? fillTpl(customText) : lines, creds, waMeter).catch(() => {})
    }
  }
  // THE VENUE'S OWN EMAIL, not ours.
  //
  // Brand, logo, colours and footer contact all come from the tenant document
  // via venueBrand(), so a venue is themed the moment it picks a colour in
  // Setup — no per-venue template, no code, no deploy. The guest is the
  // VENUE's customer; our name appears once, small, at the very bottom.
  //
  // stageAllows() is what stopped this from firing at every single status. A
  // guest ordering one coffee used to receive five of these.
  if (email && stageAllows(tenant, after.status, 'email')) {
    // THE READER'S LANGUAGE, from the order that reader placed.
    //
    // `order.lang` is recorded by MenuView when the basket is submitted, so it
    // is the language the guest was actually reading at that moment. That is
    // deliberately not the same as "the guest's language": someone who browsed
    // in English at nine should get THAT order's mail in English even if they
    // order in Arabic later. The order is the record of one interaction.
    // tenant.lang is the fallback for orders placed before this field existed.
    const mailLang = normLang(after.lang || tenant.lang || 'ar')
    const p = L(mailLang)
    const brand = venueBrand(tenant, mailLang)
    const mailStatus = (mailLang === 'en' ? STATUS_EN[after.status] : STATUS_AR[after.status]) || after.status
    const mailName = after.customerName || p('عميلنا العزيز', 'there')
    const rows = shown.map((l) => ({ name: pickName(l, mailLang, l.name), qty: l.qty, total: l.total.toFixed(2) }))
    if (hidden > 0) rows.push({ name: p(`و${hidden} صنفاً آخر`, `and ${hidden} more`), qty: 1, total: '' })
    const bodyHtml = [
      `<p style="margin:0 0 12px;">${p('مرحباً', 'Hello')} ${esc(mailName)},</p>`,
      // The venue's OWN words are never translated — a template the owner wrote
      // in their language is theirs, and machine-flipping it is not our call.
      `<p style="margin:0 0 10px;font-size:15px;">${esc(customText ? fillTpl(customText) : mailStatus)}</p>`,
      facts([
        [p('رقم الطلب', 'Order number'), code || '-'],
        [after.tableLabel ? p('الطاولة', 'Table') : '', after.tableLabel || ''],
      ], { dir: brand.dir }),
      // Its own total string: `totalText` above is shared with the WhatsApp
      // body, which is always Arabic.
      count > 0 ? lineTable(rows, p('الإجمالي', 'Total'), money(after.total, after.currency, mailLang), { dir: brand.dir }) : '',
      isPaid ? `<p style="margin:14px 0 0;font-size:14px;">${esc(thankText)}</p>` : '',
    ].filter(Boolean).join('')
    // WHICH BUTTON, AND WHEN.
    //
    // Before payment the guest has exactly one question — «where is my order» —
    // and the live order page answers it without them replying to the email or
    // phoning the counter. So tracking is the primary action on every stage up
    // to payment.
    //
    // On the PAID email the order is finished, so tracking would send them to a
    // page about something already over. That is the moment to ask for a
    // rating instead: they have just enjoyed it and are still holding the
    // phone. Tracking drops to the quiet secondary line.
    //
    // Either button is omitted entirely when its destination is missing — a
    // venue with no Maps link, or no slug — rather than rendered dead.
    const trackUrl = orderTrackUrl(tenant, event.params.oid)
    const track = trackUrl ? { label: p('متابعة الطلب', 'Track order'), href: trackUrl } : null
    const rate = mapsUrl ? { label: p('قيّمنا على خرائط جوجل', 'Rate us on Google Maps'), href: mapsUrl } : null
    const cta = isPaid ? rate : track
    const secondaryCta = isPaid ? track : null
    await sendEmail({
      to: email,
      // The SUBJECT is the first thing seen and is built out here, outside
      // shell() — an English body under an Arabic subject reads worse than an
      // all-Arabic email, so it follows the same language.
      subject: `${venueName} · ${mailStatus} ${code}`.replace(/[\r\n]+/g, ' '),
      fromName: venueName,
      lang: mailLang,
      replyTo: tenant.contactEmail || undefined,
      meter: mailMeter,
      html: shell(brand, {
        title: `${venueName} · ${mailStatus}`,
        preheader: `${mailStatus} · ${venueName}`,
        body: bodyHtml,
        cta,
        secondaryCta,
      }),
    }).catch(() => {})
  }
})

// TRIGGER: welcome email to the venue owner when a tenant is created.
const onVenueWelcomeEmail = onDocumentCreated('tenants/{tid}', async (event) => {
  const t = event.data && event.data.data()
  if (!t || !t.ownerUid) return
  const db = getFirestore()
  const uSnap = await db.doc(`users/${t.ownerUid}`).get().catch(() => null)
  const email = uSnap && uSnap.exists ? uSnap.data().email : null
  if (!email) return
  const menuUrl = (process.env.PUBLIC_BASE_URL || '') + '/m/' + encodeURIComponent(t.slug || '')
  // This fires the instant the tenant document is written, so tenant.lang has to
  // be SEEDED by createTenant (src/lib/db.js) — there is no later moment at
  // which to read it. Absent still means Arabic.
  const wl = normLang(t.lang)
  const p = L(wl)
  await sendEmail({
    // Platform onboarding, not the venue's spend — one mail per venue, ever.
    meter: 'platform',
    to: email,
    lang: wl,
    subject: p(`مرحباً بـ${(t.name || '').replace(/[\r\n]+/g, ' ')} في rbt360`, `Welcome to rbt360, ${(t.name || '').replace(/[\r\n]+/g, ' ')}`),
    // OURS, not the venue's. This is RBT 360 introducing itself to a new owner,
    // so it wears the platform identity — the one email in the venue's life
    // where that is the right answer.
    html: shell(platformBrand({}, wl), {
      title: p(`أهلاً ${t.name || ''}`, `Welcome, ${t.name || ''}`),
      preheader: p('منشأتك جاهزة، وهذا رابط منيوك', 'Your venue is ready, here is your menu link'),
      body: p(
        '<p style="margin:0 0 10px;">تم إنشاء منشأتك بنجاح. منيوك العام صار على الإنترنت وتستطيع مشاركته الآن.</p>',
        '<p style="margin:0 0 10px;">Your venue is set up. Your public menu is live and ready to share.</p>',
      )
        + `<p style="margin:0;color:#5c6270;font-size:13.5px;">${p('ابدأ بإضافة أصنافك وتخصيص مظهرك من لوحة الإدارة.', 'Start by adding your items and styling your menu from the admin panel.')}</p>`,
      cta: { label: p('فتح منيوك', 'Open your menu'), href: menuUrl },
      secondaryCta: { label: p('لوحة الإدارة', 'Admin panel'), href: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') + '/admin' },
    }),
  }).catch(() => {})
})

// TRIGGER: email a staff invite when a manager creates one (staffInvites/{email},
// doc id = the invitee's email). The invitee previously only discovered the invite
// on next login — now they get a direct notification.
const onStaffInviteEmail = onDocumentCreated('staffInvites/{id}', async (event) => {
  const inv = event.data && event.data.data()
  // The doc id is `{email}__{tenantId}` now, so the address comes from the
  // BODY. `|| event.params.id` keeps any pre-migration doc working, whose id
  // is the bare email. Getting this wrong makes invite emails stop silently.
  const email = String((inv && inv.email) || event.params.id || '').trim().toLowerCase()
  if (!inv || !email || !email.includes('@')) return
  const db = getFirestore()
  const tSnap = inv.tenantId ? await db.doc(`tenants/${inv.tenantId}`).get().catch(() => null) : null
  const venue = tSnap && tSnap.exists ? (tSnap.data().name || '') : ''
  const loginUrl = (process.env.PUBLIC_BASE_URL || '') + '/login'
  const td = tSnap && tSnap.exists ? tSnap.data() : { name: venue }
  // A staff invite is venue-facing: the invitee is joining that venue's team,
  // so it follows the venue's own language.
  const il = normLang(td.lang)
  const p = L(il)
  const role = (il === 'en'
    ? { owner: 'owner', manager: 'manager', supervisor: 'supervisor', accountant: 'accountant', marketing: 'marketing', cashier: 'cashier', barista: 'barista', waiter: 'waiter', kitchen: 'kitchen', driver: 'driver', cleaner: 'cleaner' }
    : { owner: 'مالك', manager: 'مدير', supervisor: 'مشرف', accountant: 'محاسب', marketing: 'مسؤول تسويق', cashier: 'كاشير', barista: 'باريستا', waiter: 'نادل', kitchen: 'مطبخ', driver: 'مندوب توصيل', cleaner: 'عامل نظافة' })[inv.role]
    || p('موظف', 'staff member')
  await sendEmail({
    // A staff invite is the venue's own send — a manager triggers it, and a
    // scripted invite storm is exactly the abuse the meter is here to bound.
    meter: inv.tenantId ? { db, tid: inv.tenantId, channel: 'email' } : 'platform',
    to: email,
    lang: il,
    subject: p(`دعوة للانضمام إلى ${(venue || '').replace(/[\r\n]+/g, ' ')} على rbt360`, `Invitation to join ${(venue || '').replace(/[\r\n]+/g, ' ')} on rbt360`),
    // The VENUE's identity: the invitee is joining that venue's team, not ours.
    // The tenant doc was already read above for the name — its theme fields
    // were being thrown away.
    html: shell(venueBrand(td, il), {
      title: p(`دعوة للانضمام إلى ${venue}`, `Invitation to join ${venue}`),
      preheader: p(`${venue} دعتك للانضمام إلى فريقها`, `${venue} invited you to join their team`),
      body: p(
        `<p style="margin:0 0 10px;">تمت دعوتك للانضمام إلى فريق <strong>${esc(venue)}</strong> بصفة <strong>${esc(role)}</strong>.</p>`,
        `<p style="margin:0 0 10px;">You have been invited to join the <strong>${esc(venue)}</strong> team as <strong>${esc(role)}</strong>.</p>`,
      )
        + `<p style="margin:0;color:#5c6270;font-size:13.5px;">${p('سجّل الدخول بنفس البريد الذي وصلتك عليه هذه الرسالة، وستجد المنشأة في حسابك.', 'Sign in with the same address this message reached, and the venue will be in your account.')}</p>`,
      cta: { label: p('تسجيل الدخول', 'Sign in'), href: loginUrl },
    }),
  }).catch(() => {})
})

module.exports = {
  onOrderCustomerNotify,
  onVenueWelcomeEmail,
  onStaffInviteEmail,
  // helpers for other function files:
  sendEmail,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  waCredsFor,
  emailShell,
  esc,
}
