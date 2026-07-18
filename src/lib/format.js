// Small formatting + id helpers (no external deps).

const SAR_SYMBOL = ' ر.س' // narrow space + ر.س

// Format just the number (locale-aware). Used by <Price> (with the SVG symbol)
// and by money() for text-only contexts (print receipts, notifications).
export function fmtNum(value, lang = 'ar') {
  const n = Number(value || 0)
  // Always Western (Latin) digits, in both languages — never Arabic-Indic.
  return n.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

// Plain-string money — for printed receipts / notifications where the SVG symbol
// can't render. On-screen, prefer the <Price> component (new Riyal symbol).
export function money(value, currency = 'SAR', lang = 'ar') {
  const formatted = fmtNum(value, lang)
  if (currency === 'SAR') return lang === 'ar' ? `${formatted} ر.س` : `${formatted} SAR`
  return `${formatted} ${currency}`
}

// Canonical phone form so the same number in different formats maps to ONE customer.
// Saudi-aware (0533… / +966533… / 966533… / 533… → 966533…); generic fallback strips digits.
export function normalizePhone(phone, country = 'SA') {
  let d = String(phone || '').replace(/[^0-9]/g, '')
  if (!d) return ''
  d = d.replace(/^00/, '') // drop international 00 prefix
  if (country === 'SA') {
    if (d.startsWith('966')) return d
    if (d.startsWith('0') && d.length === 10) return '966' + d.slice(1)
    if (d.length === 9 && d.startsWith('5')) return '966' + d
  }
  return d
}

// URL-safe slug from arbitrary text (keeps latin + numbers, collapses the rest).
export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[؀-ۿ]/g, '') // strip arabic for the slug
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

// Opaque random token (used for QR table tokens, order tokens).
export function randomToken(len = 12) {
  let out = ''
  const arr = new Uint32Array(len)
  ;(globalThis.crypto || window.crypto).getRandomValues(arr)
  for (let i = 0; i < len; i++) out += ALPHABET[arr[i] % ALPHABET.length]
  return out
}

// Short human order number, e.g. "#0421". Accepts a short code string or a number.
export function orderNumber(val) {
  if (val == null || val === '') return '#----'
  return `#${val}`
}

// Staff-ID prefix from the venue name/slug, e.g. "Neema Cafe" -> "NEE".
export function staffIdPrefix(tenant) {
  const src = tenant?.slug || tenant?.nameEn || tenant?.name || 'EMP'
  const letters = (String(src).match(/[a-zA-Z]/g) || []).join('')
  const p = (letters || 'EMP').slice(0, 3).toUpperCase()
  return p.length >= 2 ? p : 'EMP'
}

// Next sequential staff ID, e.g. "NEE001", "NEE002" — derived from the venue
// name and the highest existing number among current members. `extra` lets a
// caller reserve ids assigned earlier in the same pass.
export function nextStaffId(tenant, members, extra = []) {
  const prefix = staffIdPrefix(tenant)
  let max = 0
  const scan = (id) => {
    const s = String(id || '').toUpperCase()
    if (!s.startsWith(prefix)) return
    const n = parseInt(s.slice(prefix.length).replace(/\D/g, ''), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  for (const m of members || []) scan(m?.staffId)
  for (const id of extra) scan(id)
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

// Display fallback when a member has no assigned id yet (transient only).
export function staffIdFallback(tenant, uid) {
  return `${staffIdPrefix(tenant)}-${String(uid || '').slice(-4).toUpperCase()}`
}

export function timeAgo(date, lang = 'ar') {
  if (!date) return ''
  const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date)
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000))
  const mins = Math.floor(secs / 60)
  if (lang === 'ar') {
    if (secs < 60) return 'الآن'
    if (mins < 60) return `${mins} د`
    const h = Math.floor(mins / 60)
    if (h < 24) return `${h} س`
    return `${Math.floor(h / 24)} ي`
  }
  if (secs < 60) return 'now'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function minutesSince(date) {
  if (!date) return 0
  const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date)
  return Math.floor((Date.now() - d.getTime()) / 60000)
}
