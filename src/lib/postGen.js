// Post Studio generation lib — marketing image via Gemini 'gemini-2.5-flash-image'
// (nano-banana) + Arabic captions via aiQuick. Mirrors aiBridge's key/env pattern
// exactly: geminiProxy callable first (server GEMINI_API_KEY), then a direct
// generativelanguage.googleapis.com call when a local VITE_GEMINI_API_KEY exists.
// NEVER fakes an image on failure — throws a clear Arabic message instead.
import { httpsCallable } from 'firebase/functions'
import { functions, firebaseReady } from './firebase.js'
import { aiQuick } from './aiBridge.js'

export const IMAGE_MODEL = 'gemini-2.5-flash-image'

// BRAND AWARENESS: every generator can receive the tenant and weave the venue's
// real identity (colors, theme family, type, name) into the prompt — so output
// matches the venue's look instead of a generic aesthetic.
export function brandContext(tenant) {
  if (!tenant) return ''
  const bits = []
  if (tenant.name) bits.push(`venue "${tenant.name}"`)
  if (tenant.type) bits.push(tenant.type === 'restaurant' ? 'restaurant' : tenant.type === 'cafe' ? 'specialty cafe' : 'hospitality venue')
  const brand = tenant.skin?.overrides?.brand || tenant.themeColor
  const accent = tenant.skin?.overrides?.accent || tenant.themeAccent
  if (brand) bits.push(`brand primary color ${brand}${accent ? ` with accent ${accent}` : ''} — use this palette as the dominant color mood`)
  const skin = tenant.skin?.skinId
  if (skin) {
    const MOOD = { noir: 'dark luxurious night aesthetic', luxe: 'gold luxury aesthetic', classic: 'clean classic aesthetic', paper: 'warm print-editorial aesthetic', wood: 'warm heritage wood aesthetic', nova: 'bold modern aesthetic', midnight: 'deep night-blue aesthetic', golden: 'golden warm aesthetic' }
    bits.push(MOOD[skin] || `visual theme "${skin}"`)
  }
  return bits.length ? `Venue identity: ${bits.join(', ')}.` : ''
}

// Strong English image-prompts (the model composes better in English); labels Arabic.
export const PRESET_STYLES = [
  { id: 'studio', ar: 'لقطة استوديو فاخرة', prompt: 'luxury studio product shot, dramatic single spotlight on a seamless dark backdrop, subtle glossy reflections under the product, high-end advertising photography, rich contrast' },
  { id: 'marble', ar: 'خلفية رخامية', prompt: 'elegant white marble tabletop, soft side daylight, minimal tasteful props, airy negative space, premium cafe editorial aesthetic' },
  { id: 'warm', ar: 'إضاءة دافئة', prompt: 'warm golden-hour lighting, cozy cafe ambience, soft bokeh background of shelves and plants, gentle steam, inviting amber tones' },
  { id: 'minimal', ar: 'بساطة حديثة', prompt: 'modern minimalist composition, solid muted pastel background, one crisp hard shadow, product perfectly centered, bold negative space, magazine editorial style' },
  { id: 'ramadan', ar: 'رمضاني', prompt: 'Ramadan festive scene, glowing crescent and traditional lanterns softly blurred in the background, warm amber candlelight, ornamental Arabic patterns, celebratory premium mood' },
  { id: 'festive', ar: 'احتفالي', prompt: 'celebration theme, soft golden confetti and sparkling bokeh lights in the background, vibrant festive colors, joyful party mood, premium event photography' },
  { id: 'specialty', ar: 'قهوة سبيشلتي', prompt: 'specialty coffee bar scene, rustic wooden counter, barista tools and a chrome espresso machine softly blurred behind, artisanal third-wave coffee vibe, natural window light' },
  { id: 'pastel', ar: 'حلويات باستيل', prompt: 'pastel patisserie styling, creamy pink and mint tones, delicate dessert props, soft diffused light, dreamy sweet-shop aesthetic' },
]

// Runtime hygiene for generated captions (brand rule: no emojis, Latin digits only).
// Ranges written as escapes so the source-file guard itself stays clean.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE0F}]/gu
const AR_DIGITS_RE = new RegExp(String.fromCharCode(91, 1632, 45, 1641, 1776, 45, 1785, 93), "g") // [Arabic-Indic 0-9, Extended 0-9] built from char codes (source must stay digit-free)
export function cleanCaption(text = '') {
  return String(text)
    .replace(EMOJI_RE, '')
    .replace(AR_DIGITS_RE, (ch) => {
      const c = ch.charCodeAt(0)
      return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660)
    })
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

// Classify raw API errors into actionable Arabic messages (the UI shows fallback advice).
const arabicError = (raw) => {
  const s = String(raw || '')
  if (/(404|not.?found|NOT_FOUND|unsupported|is not supported)/i.test(s)) return 'نموذج توليد الصور غير متاح حالياً على هذا المفتاح — جرّب لاحقاً أو استخدم «التصميم اليدوي».'
  if (/(429|quota|exhausted|RESOURCE_EXHAUSTED|rate.?limit)/i.test(s)) return 'استُهلكت حصة توليد الصور مؤقتاً — انتظر دقيقة ثم أعد المحاولة، أو استخدم «التصميم اليدوي».'
  if (/(503|500|502|overload|unavailable|high demand|deadline|timeout)/i.test(s)) return 'نموذج الصور مزدحم الآن — أعد المحاولة بعد لحظات.'
  if (/(unauthenticated|permission)/i.test(s)) return 'توليد الصور متاح للمالك والمدير فقط، وبعد نشر الدوال السحابية.'
  return 'تعذر توليد الصورة: ' + s.slice(0, 160)
}

// One request: geminiProxy (prod) → direct call if a local key exists (same as aiQuick).
async function sendGemini(model, body) {
  try {
    const res = await httpsCallable(functions, 'geminiProxy')({ model, body })
    return res.data
  } catch (e) {
    const key = import.meta.env.VITE_GEMINI_API_KEY
    if (!key) throw new Error(arabicError(e?.message || e))
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      throw new Error(arabicError(`${r.status} ${t}`))
    }
    return r.json()
  }
}

// Blob/File → base64 inlineData part (local files never hit CORS).
async function blobToInlineData(blob) {
  const dataUrl = await new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(fr.result)
    fr.onerror = () => rej(new Error('read failed'))
    fr.readAsDataURL(blob)
  })
  const [head, data] = String(dataUrl).split(',')
  const mimeType = /data:(.*?)[;,]/.exec(head + ',')?.[1] || blob.type || 'image/jpeg'
  return { mimeType, data }
}

// Fetch a (Firebase Storage) image URL → base64 inlineData part for Gemini.
// NOTE: subject to the bucket's CORS config — callers treat failures as
// skippable (see cors.json + DOMAINS_MESSAGING_SETUP.md for the one-time fix).
async function urlToInlineData(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`fetch ${r.status}`)
  return blobToInlineData(await r.blob())
}

function b64ToBlob(b64, mime = 'image/png') {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

// Marketing visual. References come from URLs (itemImageUrls — may be blocked
// by bucket CORS) AND/OR directly-uploaded Files/Blobs (refFiles — never blocked).
// URL refs that fail to load are SKIPPED; with zero usable refs the generation
// proceeds as a free scene from the description instead of failing (the old
// hard-throw stranded users behind the missing bucket CORS config).
// Returns an image Blob. Throws a clear Arabic message only on MODEL failure.
export async function generatePostImage({ itemImageUrls = [], refFiles = [], stylePrompt = '', venueName = '', tenant = null, imitate = false } = {}) {
  if (!firebaseReady) throw new Error('الذكاء غير مهيأ — أكمل إعداد Firebase أولاً.')
  const refs = []
  for (const f of (refFiles || []).filter(Boolean).slice(0, 3)) {
    try { refs.push(await blobToInlineData(f)) } catch (_) { /* unreadable file — skip */ }
  }
  for (const u of (itemImageUrls || []).filter(Boolean).slice(0, 3 - refs.length)) {
    try { refs.push(await urlToInlineData(u)) } catch (_) { /* CORS/broken — skip, free-gen below */ }
  }
  const prompt = [
    `Professional advertising photograph for the cafe/restaurant "${venueName || tenant?.name || 'a specialty cafe'}".`,
    brandContext(tenant),
    refs.length
      ? (imitate
        ? 'IMITATE the attached reference design EXACTLY — same layout, composition, lighting, style and mood — applying ONLY the changes requested below. This is a faithful recreation, not an inspiration.'
        : 'The attached photo(s) show the EXACT real product (and possibly the venue logo) being advertised. Recreate the SAME product faithfully — same food/drink, same container and cup, same colors, garnish and proportions. If a logo image is attached, place it subtly and accurately. Do NOT invent or substitute a different product.')
      : 'Compose the scene entirely from this description (no reference photo was provided).',
    `${imitate ? 'Requested changes' : 'Composition and background'}: ${stylePrompt || 'premium marketing studio shot'}.`,
    'Appetizing, sharp focus on the product, social-media ready, square 1:1 aspect ratio.',
    'Do NOT add any text, letters, numbers or watermarks. If any incidental signage is unavoidable it must be correct, natural Arabic.',
  ].filter(Boolean).join(' ')
  const body = {
    contents: [{ role: 'user', parts: [...refs.map((r) => ({ inlineData: r })), { text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  }
  const json = await sendGemini(IMAGE_MODEL, body)
  const img = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
  if (!img) {
    const said = (json?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join(' ').trim().slice(0, 140)
    throw new Error(said ? `لم يُرجع النموذج صورة: ${said}` : 'لم يُرجع النموذج صورة — أعد المحاولة أو غيّر النمط.')
  }
  return b64ToBlob(img.inlineData.data, img.inlineData.mimeType || 'image/png')
}

// Attached-chat-images variant: refs are already base64 inlineData parts
// ({mimeType, data}) — used by the assistant's edit_attached_images tool.
export async function generateFromInlineRefs({ inlineRefs = [], stylePrompt = '', venueName = '', tenant = null, imitate = false } = {}) {
  if (!firebaseReady) throw new Error('الذكاء غير مهيأ — أكمل إعداد Firebase أولاً.')
  const refs = (inlineRefs || []).filter((r) => r && r.data).slice(0, 4)
  if (!refs.length) throw new Error('لا صور مرفقة — أرفق صورة أو أكثر مع رسالتك أولاً.')
  const prompt = [
    `Professional advertising photograph for the cafe/restaurant "${venueName || tenant?.name || 'a specialty cafe'}".`,
    brandContext(tenant),
    imitate
      ? 'IMITATE the attached reference design EXACTLY — same layout, composition, lighting, typography placement, style and mood — applying ONLY the changes requested below. A faithful recreation, not an inspiration.'
      : 'The attached image(s) are the exact references (product photos and possibly a logo). Follow the user request below faithfully, keeping the real product true to its reference. If a logo is attached, integrate it subtly and accurately.',
    `${imitate ? 'Requested changes' : 'User request'}: ${stylePrompt || 'premium marketing composition'}.`,
    'Sharp, appetizing, social-media ready, square 1:1. No invented text, letters, numbers or watermarks.',
  ].filter(Boolean).join(' ')
  const body = {
    contents: [{ role: 'user', parts: [...refs.map((r) => ({ inlineData: r })), { text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  }
  const json = await sendGemini(IMAGE_MODEL, body)
  const img = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
  if (!img) throw new Error('لم يُرجع النموذج صورة — أعد المحاولة بوصف أوضح.')
  return b64ToBlob(img.inlineData.data, img.inlineData.mimeType || 'image/png')
}

// Catchy Arabic caption + hashtags (emoji-free, Latin digits — brand consistency).
export async function generateCaption({ itemName = '', venueName = '', tone = '', offer = '' } = {}) {
  const prompt = [
    'أنت كاتب محتوى تسويقي سعودي محترف لمنشآت الضيافة.',
    `اكتب نص منشور تسويقي عربي قصير وجذاب (سطران إلى ثلاثة) عن "${itemName || 'أحد أصنافنا المميزة'}" من "${venueName || 'منشأتنا'}".`,
    tone ? `الأسلوب المطلوب: ${tone}.` : 'الأسلوب: راقٍ بلمسة سعودية خفيفة، بلا مبالغة.',
    offer ? `أدرج هذا العرض ضمن النص: ${offer}.` : '',
    'ثم أضف في سطر أخير 3 إلى 5 هاشتاقات عربية مناسبة.',
    'ممنوع منعاً باتاً: الرموز التعبيرية (الإيموجي) بكل أنواعها، والأرقام العربية المشرقية — استخدم الأرقام اللاتينية فقط.',
    'أجب بنص المنشور فقط دون أي شرح أو مقدمات.',
  ].filter(Boolean).join('\n')
  const out = cleanCaption(await aiQuick(prompt))
  if (!out) throw new Error('لم يصل رد من الذكاء — أعد المحاولة.')
  return out
}
