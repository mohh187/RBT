// Voice ordering primitives: Web Speech recognition + synthesis wrappers and a
// PURELY LOCAL Arabic-aware item matcher (no AI call — instant and free).
//
// Browser reality we handle honestly instead of pretending:
//  • SpeechRecognition is Chrome/Edge/Safari-only (webkit-prefixed). Firefox has
//    NO implementation at all — speechSupported() returns false and the UI must
//    offer a typed fallback instead of a dead mic button.
//  • Recognition needs a network round-trip in Chrome; offline throws 'network'.
//  • iOS Safari requires the call to originate from a user gesture.
//  • speechSynthesis voices load asynchronously; the first speak() may have no
//    Arabic voice yet, so we resolve the voice lazily per utterance.

// ---------------------------------------------------------------------------
// Arabic text normalization
// ---------------------------------------------------------------------------

// Tashkeel (harakat) + superscript alef + tatweel. Written as escapes so the
// source file stays plain-ASCII-safe for the hard-rules guard.
const TASHKEEL = /[ً-ْٰـ]/g
// Arabic-Indic + Extended Arabic-Indic digits, built from char codes so this
// source file itself never contains one (hard rule: Latin digits only).
const AR_DIGITS = new RegExp(String.fromCharCode(91, 1632, 45, 1641, 1776, 45, 1785, 93), 'g')

// Speech engines and guests write the same word many ways; fold them all to one
// canonical form before any comparison.
export function normalizeAr(input = '') {
  return String(input)
    .replace(AR_DIGITS, (ch) => {
      const c = ch.charCodeAt(0)
      return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660)
    })
    .replace(TASHKEEL, '')
    .replace(/[أإآٱ]/g, 'ا') // alef hamza forms -> alef
    .replace(/ة/g, 'ه') // ta marbuta -> ha
    .replace(/[ىئ]/g, 'ي') // alef maqsura / yeh hamza -> yeh
    .replace(/ؤ/g, 'و') // waw hamza -> waw
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // drop punctuation entirely
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const tokenize = (s) => normalizeAr(s).split(' ').filter(Boolean)

// Word lists and patterns MUST be folded through normalizeAr() exactly like the
// input is, or they silently never match (e.g. "أبغى" normalizes to "ابغي", so a
// literal /ابغى/ would never fire). These helpers make that impossible to forget.
export const normalizedSet = (words) => new Set(words.map((w) => normalizeAr(w)).filter(Boolean))
export const normalizedAlt = (words) => new RegExp(`(${words.map((w) => normalizeAr(w)).filter(Boolean).join('|')})`)

// Filler words that carry no dish meaning — they must never win a match.
const STOP_WORDS = normalizedSet([
  'أضف', 'ضيف', 'أضيف', 'أبغى', 'أبي', 'أريد', 'أعطني', 'عطني', 'هات', 'جيب',
  'من', 'في', 'على', 'إلى', 'عن', 'مع', 'لي', 'لو', 'سمحت', 'الله', 'يعطيك', 'العافية',
  'بس', 'كمان', 'أيضا', 'يكون', 'واحد', 'وحدة', 'كوب', 'كاس', 'حبة', 'حبات', 'صحن',
  'عندكم', 'عندك', 'وش', 'ايش', 'شنو', 'هل', 'ممكن', 'طلب', 'أطلب', 'أبغا',
  'the', 'a', 'an', 'please', 'want', 'give', 'me', 'i', 'add', 'order', 'of', 'with', 'and', 'to',
])

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

// Arabic number words a guest actually says out loud (spoken and written forms).
export const ARABIC_NUMBERS = {
  'واحد': 1, 'وحده': 1, 'واحده': 1,
  'اثنين': 2, 'اثنان': 2, 'ثنين': 2, 'اتنين': 2, 'ثنتين': 2, 'زوج': 2,
  'ثلاثه': 3, 'ثلاث': 3, 'تلاته': 3,
  'اربعه': 4, 'اربع': 4,
  'خمسه': 5, 'خمس': 5,
  'سته': 6, 'ست': 6,
  'سبعه': 7, 'سبع': 7,
  'ثمانيه': 8, 'ثمان': 8, 'تمانيه': 8,
  'تسعه': 9, 'تسع': 9,
  'عشره': 10, 'عشر': 10,
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
}

// Lookup keyed by the SAME folding applied to speech input.
const NUM_INDEX = Object.fromEntries(Object.entries(ARABIC_NUMBERS).map(([k, v]) => [normalizeAr(k), v]))

// "لاتيه اثنين" / "3 كابتشينو" / "latte x2" -> 2 | 3 | 2. Defaults to 1.
export function parseQty(transcript = '') {
  const norm = normalizeAr(transcript)
  const digit = /(?:^|\s|x|\*)(\d{1,2})(?:\s|$)/.exec(norm)
  if (digit) {
    const n = Number(digit[1])
    if (n >= 1 && n <= 20) return n
  }
  for (const tok of norm.split(' ')) {
    const n = NUM_INDEX[tok]
    if (n) return n
  }
  return 1
}

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

const INTENT_PATTERNS = [
  ['checkout', normalizedAlt(['أطلب الآن', 'أرسل الطلب', 'أرسل', 'أكمل الطلب', 'أنهي الطلب', 'ادفع', 'تأكيد الطلب', 'checkout', 'place order', 'send order'])],
  ['cart', normalizedAlt(['سلتي', 'سلة', 'الطلب حقي', 'طلبي', 'شنو طلبت', 'وش طلبت', 'cart', 'my order', 'basket'])],
  ['remove', normalizedAlt(['احذف', 'امسح', 'شيل', 'ألغِ', 'الغي', 'إلغاء', 'بدون', 'remove', 'delete', 'cancel'])],
  ['search', normalizedAlt(['عندكم', 'عندك', 'وش عندكم', 'ايش عندكم', 'فيه', 'هل يوجد', 'ابحث', 'دور', 'do you have', 'search', 'show me'])],
  ['add', normalizedAlt(['أضف', 'ضيف', 'أضيف', 'أبغى', 'أبغا', 'أبي', 'أريد', 'أعطني', 'عطني', 'هات', 'جيب', 'طلب', 'أطلب', 'add', 'i want', 'give me', 'order'])],
]

// Best-effort intent. Returns 'add' | 'remove' | 'cart' | 'checkout' | 'search' | 'unknown'.
export function parseIntent(transcript = '') {
  const norm = normalizeAr(transcript)
  if (!norm) return 'unknown'
  for (const [intent, re] of INTENT_PATTERNS) if (re.test(norm)) return intent
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Item matching (local, deterministic, no AI)
// ---------------------------------------------------------------------------

const fieldsOf = (item) => [
  { text: item?.nameAr || '', weight: 1 },
  { text: item?.nameEn || '', weight: 1 },
  { text: item?.descAr || item?.descriptionAr || '', weight: 0.28 },
  { text: item?.descEn || item?.descriptionEn || '', weight: 0.22 },
]

function scoreField(said, saidTokens, text, weight) {
  const norm = normalizeAr(text)
  if (!norm) return 0
  const nameTokens = norm.split(' ').filter(Boolean)
  let score = 0
  // Whole name spoken inside the sentence — by far the strongest signal.
  if (norm.length >= 3 && said.includes(norm)) score += 6 + Math.min(3, nameTokens.length)
  for (const st of saidTokens) {
    for (const nt of nameTokens) {
      if (st === nt) score += 3
      else if (st.length >= 3 && nt.includes(st)) score += 1.6
      else if (nt.length >= 3 && st.includes(nt)) score += 1.2
    }
  }
  return score * weight
}

// Ranked local matches: [{ item, score }] sorted best-first (score > 0 only).
export function matchItems(transcript = '', items = [], lang = 'ar') {
  const said = normalizeAr(transcript)
  if (!said) return []
  const saidTokens = tokenize(transcript).filter((tk) => !STOP_WORDS.has(tk) && !(tk in NUM_INDEX) && !/^\d+$/.test(tk))
  if (!saidTokens.length && said.length < 3) return []
  const out = []
  for (const item of items || []) {
    if (!item) continue
    let score = 0
    for (const f of fieldsOf(item)) score += scoreField(said, saidTokens, f.text, f.weight)
    if (score <= 0) continue
    // Prefer the guest's current language slightly, and push sold-out items down
    // (they still appear, so we can say "this one is unavailable" honestly).
    if (lang === 'en' && item.nameEn) score += 0.3
    if (item.available === false || (item.trackStock && (item.stock || 0) <= 0)) score *= 0.45
    out.push({ item, score: Math.round(score * 100) / 100 })
  }
  return out.sort((a, b) => b.score - a.score)
}

// "لاتيه كبير" -> the large variant. Falls back to the first variant.
export function pickVariant(transcript = '', item) {
  const variants = item?.variants || []
  if (!variants.length) return null
  const said = normalizeAr(transcript)
  for (const v of variants) {
    const n = normalizeAr(v?.nameAr || v?.name || v?.nameEn || '')
    if (n && n.length >= 2 && said.includes(n)) return v
  }
  return variants[0]
}

// True when the guest must choose something we are not allowed to guess.
export function needsChoices(item) {
  return (item?.modifierGroups || []).some((g) => Math.max(Number(g?.min) || 0, g?.required ? 1 : 0) > 0)
}

// ---------------------------------------------------------------------------
// Speech recognition
// ---------------------------------------------------------------------------

const RecognitionCtor = () => (typeof window === 'undefined' ? null : (window.SpeechRecognition || window.webkitSpeechRecognition || null))

// Firefox (and any non-WebSpeech browser) returns false — callers MUST show a
// typed fallback rather than a disabled mic.
export function speechSupported() {
  return !!RecognitionCtor()
}

const codedError = (code, message) => {
  const e = new Error(message || code)
  e.code = code
  return e
}

// Human Arabic text for every honest failure mode.
export function speechErrorText(code, lang = 'ar') {
  const ar = {
    denied: 'الميكروفون مرفوض — فعّل إذن الميكروفون لهذا الموقع من إعدادات المتصفح ثم أعد المحاولة.',
    nomatch: 'لم أسمع شيئاً واضحاً — قرّب الجهاز وحاول مرة أخرى.',
    network: 'التعرف على الصوت يحتاج اتصالاً بالإنترنت — تحقق من الشبكة.',
    unsupported: 'التعرف على الصوت غير مدعوم في هذا المتصفح — جرّب Chrome أو Safari.',
    aborted: 'تم إيقاف الاستماع.',
  }
  const en = {
    denied: 'Microphone blocked — allow microphone access for this site, then try again.',
    nomatch: 'I did not catch that — please try again.',
    network: 'Speech recognition needs an internet connection.',
    unsupported: 'Speech recognition is not supported in this browser — try Chrome or Safari.',
    aborted: 'Listening stopped.',
  }
  const table = lang === 'en' ? en : ar
  return table[code] || table.unsupported
}

let activeRec = null

// Abort any in-flight recognition session (unmount / user pressed stop).
export function stopListening() {
  const rec = activeRec
  activeRec = null
  if (!rec) return
  try { rec.abort ? rec.abort() : rec.stop() } catch (_) { /* already dead */ }
}

// One recognition session -> Promise<string>. Rejects with err.code of
// 'denied' | 'nomatch' | 'unsupported' | 'network' | 'aborted'.
export function listenOnce({ lang = 'ar-SA', onPartial, silenceMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const Ctor = RecognitionCtor()
    if (!Ctor) { reject(codedError('unsupported')); return }
    stopListening() // never run two sessions at once — the engine allows only one

    let rec
    try { rec = new Ctor() } catch (_) { reject(codedError('unsupported')); return }
    rec.lang = lang
    rec.continuous = false
    rec.interimResults = true
    rec.maxAlternatives = 1

    let final = ''
    let settled = false
    let timer = null

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null }
      rec.onresult = null
      rec.onerror = null
      rec.onend = null
      rec.onaudioend = null
      if (activeRec === rec) activeRec = null
      try { rec.abort ? rec.abort() : rec.stop() } catch (_) { /* fine */ }
    }
    const done = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }
    // Silence watchdog — restarted on every partial result.
    const arm = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const said = final.trim()
        if (said) done(resolve, said)
        else done(reject, codedError('nomatch'))
      }, silenceMs)
    }

    rec.onresult = (ev) => {
      let interim = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]
        if (!r || !r[0]) continue
        if (r.isFinal) final += `${r[0].transcript} `
        else interim += r[0].transcript
      }
      const live = `${final}${interim}`.trim()
      if (live && typeof onPartial === 'function') { try { onPartial(live) } catch (_) { /* UI issue only */ } }
      arm()
    }
    rec.onerror = (ev) => {
      const code = ev?.error
      if (code === 'not-allowed' || code === 'service-not-allowed') done(reject, codedError('denied'))
      else if (code === 'no-speech' || code === 'no-match') done(reject, codedError('nomatch'))
      else if (code === 'network') done(reject, codedError('network'))
      else if (code === 'aborted') done(reject, codedError('aborted'))
      else done(reject, codedError('unsupported', code))
    }
    rec.onend = () => {
      const said = final.trim()
      if (said) done(resolve, said)
      else done(reject, codedError('nomatch'))
    }

    activeRec = rec
    try { rec.start() } catch (_) {
      // start() throws if a previous session is still tearing down.
      done(reject, codedError('unsupported'))
      return
    }
    arm()
  })
}

// ---------------------------------------------------------------------------
// Speech synthesis
// ---------------------------------------------------------------------------

export function speechAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function'
}

function pickVoice(lang) {
  try {
    const voices = window.speechSynthesis.getVoices() || []
    if (!voices.length) return null
    const base = String(lang || '').slice(0, 2).toLowerCase()
    return voices.find((v) => String(v.lang || '').toLowerCase() === String(lang).toLowerCase())
      || voices.find((v) => String(v.lang || '').toLowerCase().startsWith(base))
      || null
  } catch (_) { return null }
}

export function stopSpeaking() {
  if (!speechAvailable()) return
  try { window.speechSynthesis.cancel() } catch (_) { /* fine */ }
}

// Speak text aloud. Always resolves (never rejects) so callers can `await` it as
// a pacing primitive even when TTS is missing or silently fails.
export function speak(text, { lang = 'ar-SA', rate = 0.98, pitch = 1 } = {}) {
  const said = String(text || '').trim()
  if (!said || !speechAvailable()) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok) => { if (!settled) { settled = true; resolve(ok) } }
    try {
      window.speechSynthesis.cancel()
      const u = new window.SpeechSynthesisUtterance(said)
      u.lang = lang
      u.rate = rate
      u.pitch = pitch
      const v = pickVoice(lang)
      if (v) u.voice = v
      u.onend = () => finish(true)
      u.onerror = () => finish(false)
      window.speechSynthesis.speak(u)
      // Some engines never fire onend (known Chrome bug on long strings) —
      // release the caller after a generous ceiling so the UI can never hang.
      setTimeout(() => finish(false), Math.min(20000, 2200 + said.length * 95))
    } catch (_) { finish(false) }
  })
}

// Spoken money — the Riyal SVG cannot be read aloud, and Latin digits only.
export function priceSpeech(value, currency = 'SAR', lang = 'ar') {
  const n = Number(value || 0)
  const num = n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })
  if (currency === 'SAR') return lang === 'en' ? `${num} riyals` : `${num} ريال`
  return lang === 'en' ? `${num} ${currency}` : `${num} ${currency}`
}
