// The `qrcode` package is ~73 kB and is ONLY needed to rasterise a QR image.
// The url helpers below are plain string builders that admin shells (and other
// eager modules) import, so a static import dragged the whole encoder into the
// entry chunk. qrDataUrl was already async, so loading it on demand is free.
export function publicBaseUrl() {
  return import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin
}

// URL a diner reaches when scanning a table QR.
export function tableUrl(slug, token) {
  return `${publicBaseUrl()}/t/${slug}/${token}`
}

// URL for the general public menu (no table).
export function menuUrl(slug) {
  return `${publicBaseUrl()}/m/${slug}`
}

// Digital pass (ticket | reservation) URL — encoded in the pass QR.
export function passUrl(slug, kind, id, token) {
  return `${publicBaseUrl()}/pass/${slug}/${kind}/${id}?t=${token}`
}

export async function qrDataUrl(text, opts = {}) {
  const { default: QRCode } = await import('qrcode')
  return QRCode.toDataURL(text, {
    width: opts.width || 512,
    margin: opts.margin ?? 2,
    color: { dark: opts.dark || '#211913', light: opts.light || '#ffffff' },
    errorCorrectionLevel: 'M',
  })
}

// Generates QR codes for all tables and opens a printable multi-card sheet.
export async function printAllTableQrs(tables, slug, { venueName = '', lang = 'ar' } = {}) {
  const ar = lang === 'ar'
  const cards = await Promise.all(
    (tables || []).map(async (t) => {
      const url = tableUrl(slug, t.qrToken)
      const dataUrl = await qrDataUrl(url, { width: 360 })
      return { label: t.label, url, dataUrl }
    }),
  )
  if (!cards.length) return
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return
  const cardHtml = cards
    .map(
      (c) => `<div class="card">
        <div class="venue">${venueName}</div>
        <h2>${c.label}</h2>
        <img src="${c.dataUrl}" alt="QR"/>
        <div class="cta">${ar ? 'امسح للطلب · Scan to order' : 'Scan to order'}</div>
      </div>`,
    )
    .join('')
  w.document.write(`<!doctype html><html dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${ar ? 'رموز الطاولات' : 'Table QR codes'}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@700;800&family=Tajawal:wght@500;700&display=swap');
    *{margin:0;box-sizing:border-box;font-family:'Tajawal',sans-serif}
    body{background:#fff;color:#0a0a0b;padding:14px}
    .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
    .card{border:2px solid #e7e7ea;border-radius:18px;padding:18px;text-align:center;break-inside:avoid;page-break-inside:avoid}
    .venue{color:#6b6b76;font-weight:700;font-size:12px}
    h2{font-family:'Cairo';font-size:22px;margin:4px 0 10px}
    img{width:230px;height:230px}
    .cta{margin-top:8px;font-family:'Cairo';font-weight:800;color:#171717;font-size:14px}
    @media print{@page{margin:10mm}}
  </style></head><body>
    <div class="grid">${cardHtml}</div>
    <script>window.onload=function(){window.print()}</script>
  </body></html>`)
  w.document.close()
}

// Opens a print window with a clean printable QR card.
export function printQrCard({ dataUrl, title, subtitle, url }) {
  const w = window.open('', '_blank', 'width=480,height=680')
  if (!w) return
  w.document.write(`
    <html dir="rtl"><head><title>${title}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@700;800&family=Tajawal:wght@500;700&display=swap');
      *{margin:0;box-sizing:border-box;font-family:'Tajawal',sans-serif}
      body{display:grid;place-items:center;min-height:100vh;background:#fff;color:#211913}
      .card{text-align:center;padding:40px;border:2px solid #e7dcd0;border-radius:24px;width:380px}
      h1{font-family:'Cairo';font-size:28px;margin-bottom:6px}
      .sub{color:#6e5f52;margin-bottom:20px;font-weight:700}
      img{width:300px;height:300px}
      .url{margin-top:16px;font-size:12px;color:#9a8a7a;word-break:break-all}
      .cta{margin-top:16px;font-family:'Cairo';font-weight:800;font-size:18px;color:#8b5e3c}
      @media print{.no-print{display:none}}
    </style></head><body>
      <div class="card">
        <h1>${title}</h1>
        <div class="sub">${subtitle || ''}</div>
        <img src="${dataUrl}" alt="QR"/>
        <div class="cta">امسح للطلب · Scan to order</div>
        <div class="url">${url}</div>
      </div>
      <script>window.onload=()=>{window.print()}</script>
    </body></html>`)
  w.document.close()
}
