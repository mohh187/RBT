import { fmtNum, orderNumber } from './format.js'
import { qrDataUrl } from './qr.js'

// ZATCA (Saudi e-invoice) Phase-1 simplified TLV QR: tags 1..5 = seller, VAT no, ISO ts, total, VAT.
function tlv(tag, value) {
  const val = new TextEncoder().encode(String(value))
  return [tag, val.length, ...val]
}
function zatcaBase64({ seller, vatNo, ts, total, vat }) {
  const bytes = [...tlv(1, seller), ...tlv(2, vatNo), ...tlv(3, ts), ...tlv(4, total), ...tlv(5, vat)]
  let bin = ''
  bytes.forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin)
}

// New Saudi Riyal symbol as inline SVG (currentColor) for the printed receipt.
const RIYAL_SVG = '<svg viewBox="0 0 1124.14 1256.39" width="0.82em" height="0.82em" style="display:inline-block;vertical-align:-0.08em;fill:currentColor"><path d="M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z"/><path d="M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z"/></svg>'

// Price string for the receipt — symbol left in AR, right in EN.
function priceHtml(value, currency, lang) {
  const num = fmtNum(value, lang)
  if (currency && currency !== 'SAR') return lang === 'ar' ? `${currency} ${num}` : `${num} ${currency}`
  return lang === 'ar' ? `${RIYAL_SVG} ${num}` : `${num} ${RIYAL_SVG}`
}

// Opens a print window styled like an 80mm thermal receipt for one or more orders.
// proforma=true prints an unpaid "bill" (no tax-invoice label / no ZATCA QR).
export async function printReceipt(orders, { tenant, lang = 'ar', title, proforma = false } = {}) {
  const list = Array.isArray(orders) ? orders : [orders]
  if (!list.length) return
  const currency = tenant?.currency || 'SAR'
  const ar = lang === 'ar'
  const name = (l) => (lang === 'en' && l.nameEn ? l.nameEn : l.nameAr)
  const vatEnabled = tenant?.vatEnabled && currency === 'SAR'
  const vatRate = Number(tenant?.vatRate ?? 15) || 15

  // Custom Receipt Design variables from database
  const receiptShowLogo = tenant?.receiptShowLogo !== false
  const receiptShowVat = tenant?.receiptShowVat !== false
  const receiptShowBarcode = tenant?.receiptShowBarcode !== false
  const receiptShowCustomer = tenant?.receiptShowCustomer !== false
  const receiptFontSize = tenant?.receiptFontSize || 'medium'
  const receiptHeader = tenant?.receiptHeader || ''
  const receiptFooter = tenant?.receiptFooter || ''
  const receiptExtraNote = tenant?.receiptExtraNote || ''

  const fSize = receiptFontSize === 'small' ? '11px' : receiptFontSize === 'large' ? '15px' : '13px'

  let subtotal = 0
  let discount = 0
  let loyalty = 0
  let member = 0
  let total = 0
  const rows = []
  list.forEach((o) => {
    ;(o.items || []).forEach((l) => {
      rows.push(`<tr><td>${l.qty}×</td><td>${name(l)}${l.variantLabel ? `<br><small>${l.variantLabel}</small>` : ''}</td><td style="text-align:end">${priceHtml(l.lineTotal, currency, lang)}</td></tr>`)
    })
    subtotal += o.subtotal || 0
    discount += o.discount || 0
    loyalty += o.loyaltyDiscount || 0
    member += o.memberDiscount || 0
    total += o.total || 0
  })

  const nums = list.map((o) => orderNumber(o.code)).join('، ')
  const tableLabel = list[0]?.tableLabel || ''
  const vat = vatEnabled ? Math.round((total - total / (1 + vatRate / 100)) * 100) / 100 : 0
  const isTaxInvoice = !proforma && vatEnabled && tenant?.vatNumber

  // open the window synchronously (keeps the user gesture), then fill it in
  const w = window.open('', '_blank', 'width=380,height=620')
  if (!w) return
  let barcodeImg = ''
  if (isTaxInvoice) {
    try {
      const ts = new Date(list[0]?.createdAt?.toMillis?.() || Date.now()).toISOString()
      const b64 = zatcaBase64({ seller: tenant?.name || 'RBT360', vatNo: tenant.vatNumber, ts, total: total.toFixed(2), vat: vat.toFixed(2) })
      const dataUrl = await qrDataUrl(b64, { width: 220 })
      barcodeImg = `<div class="c"><img src="${dataUrl}" style="width:120px;height:120px" alt="ZATCA"/></div>`
    } catch (_) { /* ignore */ }
  } else if (receiptShowBarcode) {
    try {
      const dataUrl = await qrDataUrl(list[0]?.code || '0000', { width: 180 })
      barcodeImg = `<div class="c" style="margin-top:10px"><img src="${dataUrl}" style="width:100px;height:100px" alt="QR"/><div style="font-size:9px;letter-spacing:2px;color:#555;margin-top:4px">* ${list[0]?.code || ''} *</div></div>`
    } catch (_) { /* ignore */ }
  }

  const logoImg = receiptShowLogo && tenant?.logoUrl
    ? `<div class="c" style="margin-bottom:8px"><img src="${tenant.logoUrl}" style="width:60px;height:60px;border-radius:50%;object-fit:cover;filter:grayscale(100%) contrast(150%)" alt="Logo"/></div>`
    : ''

  const headerHtml = receiptHeader
    ? `<div class="c" style="white-space:pre-line;font-weight:700;margin-bottom:6px">${receiptHeader}</div>`
    : `<div class="c">
        <h1>${tenant?.name || 'RBT360'}</h1>
        ${tenant?.phone ? `<div class="muted">${tenant.phone}</div>` : ''}
       </div>`

  const footerHtml = receiptFooter
    ? `<div class="c muted" style="white-space:pre-line;margin-top:10px;font-size:11px">${receiptFooter}</div>`
    : `<div class="c muted">${proforma ? (ar ? 'هذا ليس إيصال دفع' : 'Not a payment receipt') : (ar ? 'شكراً لزيارتكم' : 'Thank you!')}</div>`

  w.document.write(`<!doctype html><html dir="${ar ? 'rtl' : 'ltr'}" lang="${lang}"><head><meta charset="utf-8"><title>${title || nums}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');
    *{margin:0;padding:0;box-sizing:border-box;font-family:'Tajawal',monospace}
    body{width:80mm;padding:10px 12px;color:#000;background:#fff;font-size:${fSize}}
    .c{text-align:center}
    h1{font-size:17px;margin-bottom:2px}
    .muted{color:#444;font-size:11px}
    hr{border:none;border-top:1px dashed #999;margin:8px 0}
    table{width:100%;border-collapse:collapse}
    td{padding:3px 0;vertical-align:top}
    small{color:#555}
    .tot{display:flex;justify-content:space-between;font-size:${fSize};margin:2px 0}
    .grand{font-weight:800;font-size:15px;border-top:1px solid #000;padding-top:6px;margin-top:6px}
    @media print{@page{margin:0}}
  </style></head><body>
    ${logoImg}
    ${headerHtml}
    <div class="c">
      ${tenant?.vatNumber && !proforma ? `<div class="muted">${ar ? 'الرقم الضريبي' : 'VAT No'}: ${tenant.vatNumber}</div>` : ''}
      <div class="muted" style="font-weight:700;margin-top:3px">${proforma ? (ar ? '— حساب مبدئي (غير مدفوع) —' : '— Proforma (unpaid) —') : isTaxInvoice ? (ar ? 'فاتورة ضريبية مبسطة' : 'Simplified Tax Invoice') : ''}</div>
      ${tableLabel ? `<div class="muted">${ar ? 'طاولة' : 'Table'}: ${tableLabel}</div>` : ''}
      <div class="muted">${ar ? 'طلب' : 'Order'}: ${nums}</div>
      ${receiptShowCustomer && list[0]?.customerName ? `<div class="muted">${ar ? 'العميل' : 'Customer'}: ${list[0].customerName}${list[0].customerPhone ? ` · ${list[0].customerPhone}` : ''}</div>` : ''}
      ${(list[0]?.servedByName || list[0]?.acceptedByName) ? `<div class="muted">${ar ? 'الكاشير' : 'Served by'}: ${list[0].servedByName || list[0].acceptedByName}</div>` : ''}
    </div>
    <hr>
    <table>${rows.join('')}</table>
    <hr>
    <div class="tot"><span>${ar ? 'المجموع الفرعي' : 'Subtotal'}</span><span>${priceHtml(subtotal, currency, lang)}</span></div>
    ${discount ? `<div class="tot"><span>${ar ? 'الخصم' : 'Discount'}</span><span>-${priceHtml(discount, currency, lang)}</span></div>` : ''}
    ${loyalty ? `<div class="tot"><span>${ar ? 'ولاء' : 'Loyalty'}</span><span>-${priceHtml(loyalty, currency, lang)}</span></div>` : ''}
    ${member ? `<div class="tot"><span>${ar ? 'خصم العضوية' : 'Member'}</span><span>-${priceHtml(member, currency, lang)}</span></div>` : ''}
    ${vatEnabled && receiptShowVat ? `<div class="tot"><span>${ar ? `شامل ض.ق.م (${vatRate}%)` : `incl. VAT (${vatRate}%)`}</span><span>${priceHtml(vat, currency, lang)}</span></div>` : ''}
    <div class="tot grand"><span>${ar ? 'الإجمالي الكلي' : 'Total'}</span><span>${priceHtml(total, currency, lang)}</span></div>
    <hr>
    ${barcodeImg}
    ${footerHtml}
    ${receiptExtraNote ? `<div class="c muted" style="margin-top:6px;font-style:italic;font-size:10px">* ${receiptExtraNote} *</div>` : ''}
    <script>window.onload=function(){window.print()}</script>
  </body></html>`)
  w.document.close()
}
