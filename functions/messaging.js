// ============ Customer & venue messaging: Email (Resend) + WhatsApp (Meta) ============
// - Email via Resend (RESEND_API_KEY) — transactional emails (welcome, receipts).
// - WhatsApp via Meta Cloud API (WA_PHONE_NUMBER_ID + WA_ACCESS_TOKEN) — order
//   status updates delivered to the CUSTOMER's WhatsApp (not just the menu page).
// Both fail-soft: if the provider env is unset, the send is skipped (no crash).
// Only the TRIGGERS are registered as Cloud Functions (in index.js); the send
// helpers are required by other function files.
const { onDocumentUpdated, onDocumentCreated } = require('firebase-functions/v2/firestore')
const { getFirestore } = require('firebase-admin/firestore')

// ---------------------------- Email (Resend) ----------------------------
// fromName brands the sender per venue: «مقهى مزاج عبر rbt360 <no-reply@rbt360sa.com>»
// — the address stays the platform's verified domain (Resend requirement), only the
// display name carries the venue identity. replyTo can be the venue's real inbox.
function brandedFrom(fromName) {
  const base = process.env.EMAIL_FROM || 'RBT360 <onboarding@resend.dev>'
  if (!fromName) return base
  const addr = (base.match(/<([^>]+)>/) || [])[1] || base
  const clean = String(fromName).replace(/[\r\n<>"]/g, '').trim().slice(0, 60)
  return clean ? `${clean} عبر rbt360 <${addr}>` : base
}
async function sendEmail({ to, subject, html, replyTo, fromName }) {
  const key = process.env.RESEND_API_KEY
  if (!key || !to || !subject) return { ok: false, skipped: true }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      // charset stated explicitly: Arabic subjects and bodies must not be left
      // to the receiver's guess.
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ from: brandedFrom(fromName), to: Array.isArray(to) ? to : [to], subject, html, reply_to: replyTo || undefined }),
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
async function sendWhatsAppTemplate(to, templateName, langCode, bodyParams, creds) {
  const token = (creds && creds.token) || process.env.WA_ACCESS_TOKEN
  const phoneId = (creds && creds.phoneId) || process.env.WA_PHONE_NUMBER_ID
  const msisdn = normalizeMsisdn(to)
  if (!token || !phoneId || !templateName || !msisdn) return { ok: false, skipped: true }
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
async function sendWhatsAppText(to, text, creds) {
  const token = (creds && creds.token) || process.env.WA_ACCESS_TOKEN
  const phoneId = (creds && creds.phoneId) || process.env.WA_PHONE_NUMBER_ID
  const msisdn = normalizeMsisdn(to)
  if (!token || !phoneId || !msisdn) return { ok: false, skipped: true }
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
const NOTIFY_STATUSES = ['accepted', 'preparing', 'ready', 'served', 'cancelled', 'refunded']

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

  if (phone && ch.whatsapp !== false) {
    // Venue's own approved template name wins; else the platform template.
    const tmpl = (creds && creds.templates && creds.templates.templateOrderUpdate) || process.env.WA_TEMPLATE_ORDER_UPDATE
    if (tmpl) {
      // Template vars: {{1}} venue, {{2}} order code, {{3}} status text.
      await sendWhatsAppTemplate(phone, tmpl, lang, [venueName, code || '-', statusText], creds).catch(() => {})
    } else {
      // No approved template configured yet → best-effort free-form (24h window only).
      await sendWhatsAppText(phone, customText ? fillTpl(customText) : `${venueName}\n${statusText} ${code}`, creds).catch(() => {})
    }
  }
  if (email && ch.email !== false) {
    await sendEmail({
      to: email, subject: `${venueName} — ${statusText} ${code}`.replace(/[\r\n]+/g, ' '),
      fromName: venueName, replyTo: tenant.contactEmail || undefined,
      html: emailShell(esc(venueName), `<p style="font-size:16px">${esc(customText ? fillTpl(customText) : statusText)}</p><p style="color:#5c5c66">رقم الطلب: ${esc(code)}</p>`),
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
  await sendEmail({
    to: email,
    subject: `مرحباً بك في rbt360 — ${(t.name || '').replace(/[\r\n]+/g, ' ')}`,
    html: emailShell(`أهلاً ${esc(t.name || '')}`, `
      <p>تم إنشاء منشأتك بنجاح. رابط منيوك العام:</p>
      <p><a href="${esc(menuUrl)}" style="color:#7c2d2d;font-weight:700">${esc(menuUrl)}</a></p>
      <p style="color:#5c5c66">ابدأ بإضافة أصنافك وتخصيص مظهرك من لوحة الإدارة.</p>`),
  }).catch(() => {})
})

// TRIGGER: email a staff invite when a manager creates one (staffInvites/{email},
// doc id = the invitee's email). The invitee previously only discovered the invite
// on next login — now they get a direct notification.
const onStaffInviteEmail = onDocumentCreated('staffInvites/{email}', async (event) => {
  const inv = event.data && event.data.data()
  const email = event.params.email
  if (!inv || !email || !email.includes('@')) return
  const db = getFirestore()
  const tSnap = inv.tenantId ? await db.doc(`tenants/${inv.tenantId}`).get().catch(() => null) : null
  const venue = tSnap && tSnap.exists ? (tSnap.data().name || '') : ''
  const loginUrl = (process.env.PUBLIC_BASE_URL || '') + '/login'
  const roleAr = { owner: 'مالك', manager: 'مدير', cashier: 'كاشير', waiter: 'نادل', kitchen: 'مطبخ' }[inv.role] || 'موظف'
  await sendEmail({
    to: email,
    subject: `دعوة للانضمام إلى ${(venue || '').replace(/[\r\n]+/g, ' ')} على rbt360`,
    html: emailShell(`دعوة للعمل في ${esc(venue)}`, `
      <p>تمت دعوتك للانضمام إلى فريق <strong>${esc(venue)}</strong> بصفة <strong>${esc(roleAr)}</strong>.</p>
      <p>سجّل الدخول بهذا البريد لتفعيل حسابك:</p>
      <p><a href="${esc(loginUrl)}" style="color:#7c2d2d;font-weight:700">${esc(loginUrl)}</a></p>`),
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
