// Gemini function-calling bridge: runs the manager-assistant agent loop.
// The model can only act through the action registry; Firestore rules remain the real guard.
import { httpsCallable } from 'firebase/functions'
import { functions, firebaseReady, db } from './firebase.js'
import { collection, query, getDocs, where } from 'firebase/firestore'
import { ACTIONS_BY_NAME, TOOL_DECLARATIONS, toolDeclarationsFor } from './actions.js'
import { buildContext } from './aiContext.js'
import { logAi, getAiUsage, bumpAiUsage, listItems, listCategories } from './db.js'
import { venueType, venueAiContext, lex } from './venueTypes.js'
import { analyzeBrand } from './brandInsight.js'

const MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.5-flash'

// Fast = quick flash model; Deep = stronger reasoning model for complex analysis/plans.
export const AI_MODELS = { fast: MODEL || 'gemini-2.5-flash', deep: 'gemini-2.5-pro' }

export const aiConfigured = () => firebaseReady

// One-shot completion (no tools, no history) — powers small "improve with AI"
// buttons (e.g. the campaign composer). Returns plain text or throws.
// withSearch: true grounds the answer in live Google Search results (market
// research / competitor / trend questions) — run as a SEPARATE call because
// Gemini does not mix google_search with function-calling in one request.
// `logAs` opts this call into «سجل التوليد»: pass { tid, kind, section } and
// the prompt, result and duration are recorded (successes and failures alike).
// Omit it and nothing is logged — internal/system calls stay out of the log.
export async function aiQuick(prompt, { model = 'gemini-2.5-flash', withSearch = false, logAs = null } = {}) {
  if (!firebaseReady) throw new Error('AI not configured')
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(withSearch ? { tools: [{ google_search: {} }] } : {}),
  }
  let gen = null
  if (logAs?.tid) {
    const { startGen } = await import('./genLog.js')
    gen = startGen(logAs.tid, { kind: logAs.kind || 'text', section: logAs.section || '', prompt, model, itemId: logAs.itemId || null })
  }
  const ok = (text) => { gen?.done({ text }); return text }
  try {
    const res = await httpsCallable(functions, 'geminiProxy')({ model, body })
    return ok(res.data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('').trim() || '')
  } catch (e) {
    const key = import.meta.env.VITE_GEMINI_API_KEY
    if (!key) { gen?.fail(String(e?.message || e)); throw new Error('AI error: ' + (e?.message || e)) }
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error('AI error: ' + r.status)
      const j = await r.json()
      return ok(j.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('').trim() || '')
    } catch (e2) {
      gen?.fail(String(e2?.message || e2))
      throw e2
    }
  }
}

// VENUE IDENTITY BLOCK — who this business actually is, in its own words.
// Everything here is derived (venueTypes) or measured (brandInsight); nothing is
// invented. With no `tenant.type` set it returns [] and the prompt reads exactly
// as it did before the venue-type system existed.
function venueIdentityLines(tenant, insight) {
  if (!tenant?.type) return []
  const vt = venueType(tenant)
  const brief = venueAiContext(tenant)
  const L = {
    item: lex(tenant, 'item'), items: lex(tenant, 'items'), menu: lex(tenant, 'menu'),
    category: lex(tenant, 'category'), categories: lex(tenant, 'categories'),
    order: lex(tenant, 'order'), cart: lex(tenant, 'cart'),
    guest: lex(tenant, 'guest'), guests: lex(tenant, 'guests'), place: lex(tenant, 'place'),
  }
  const lines = [
    `VENUE TYPE (authoritative — this overrides any default cafe/restaurant assumption): ${vt?.ar || ''}${vt?.en ? ` / ${vt.en}` : ''}.`,
  ]
  if (brief) lines.push(`VENUE BRIEF: ${brief}`)
  lines.push(
    'VOCABULARY (hard): speak this venue\'s own words in EVERY Arabic reply, heading, table and message you write. ' +
    `Say «${L.item}» / «${L.items}» (never a foreign noun from another trade), «${L.menu}» for the catalogue, ` +
    `«${L.category}» / «${L.categories}» for grouping, «${L.order}» for a purchase, «${L.cart}» for the basket, ` +
    `«${L.guest}» / «${L.guests}» for the customer, and «${L.place}» for the premises. ` +
    'Tool names and JSON field names stay in English exactly as declared — only the prose you write to the user changes.'
  )
  if (vt?.aiPersona) lines.push(`VENUE PERSONA: ${vt.aiPersona}`)
  lines.push(
    `RELEVANCE (hard): only ever suggest products, ingredients, marketing angles and imagery that a ${vt?.ar || 'منشأة'} genuinely sells. ` +
    'Never propose an item, technique or prop from a different kind of business.'
  )
  if (insight?.paragraph) {
    lines.push(`BRAND PROFILE — measured from this venue's OWN records (colours, item names/descriptions, prices, photo coverage). Treat it as style guidance, and treat anything it marks as unknown as genuinely unknown — do NOT fill the gap with a guess: ${insight.paragraph}`)
  }
  return lines
}

function systemPrompt(ctx, cfg = {}, tenant = null, insight = null) {
  let personaPrompt = ''
  if (cfg.persona === 'formal') {
    personaPrompt = 'تحدث بأسلوب رسمي، مهني، ومحترف للغاية، واستخدم المصطلحات العملية والمهنية بوقار.'
  } else if (cfg.persona === 'funny') {
    personaPrompt = 'تحدث بأسلوب فكاهي، مرح ومحبب جداً للعملاء، ومزوداً بردود طريفة ورموز تعبيرية مرحة.'
  } else if (cfg.persona === 'classic') {
    personaPrompt = 'تحدث بأسلوب كلاسيكي، موجز ومباشر جداً، وتجنب الإسهاب والحشو الزائد.'
  } else {
    personaPrompt = 'تحدث بأسلوب ودي، ترحابي، ولطيف وبسيط لمساعدة العملاء بمحبة واهتمام.'
  }
  
  let modePrompt = ''
  if (cfg.mode === 'menu') {
    modePrompt = 'صلاحياتك تنحصر فقط في شرح المنيو ومساعدة العملاء في اختيار الأصناف وتلقي الطلبات. لا تقم بالرد على أي أسئلة فنية أو شكاوى أو أية أمور خارج هذا النطاق.'
  } else if (cfg.mode === 'support') {
    modePrompt = 'صلاحياتك تنحصر فقط في الدعم الفني وخدمة العملاء وحل المشكلات الفنية وتلقي الملاحظات والشكاوى للمنشأة.'
  }

  const vt = tenant?.type ? venueType(tenant) : null
  const venueLabel = vt?.en || 'café/restaurant'

  return [
    `You are the AI General Manager of the ${venueLabel} "${ctx.venue || ''}". Act with the full authority of the owner — decisive, precise, careful, and rational. You are one of the strongest managers/analysts in this field.`,
    ...venueIdentityLines(tenant, insight),
    'SCOPE & PRIVACY (hard): You serve THIS venue ONLY. Every tool is locked to this venue; you have NO access to any other establishment and cannot fetch, reference, or infer another business\'s data. Be this venue\'s strongest, most loyal operator.',
    'Your tools let you do essentially anything a manager can do by hand: full MENU (items, prices, availability, categories, recipes, duplicate, reorder, product images, per-item promo tags, design/branding, live preview), OFFERS, full INVENTORY (materials, receive/count/waste/produce, suppliers, purchase orders), ORDERS & cashier (advance/pay/refund/comp/edit lines/move table/create), TABLES & RESERVATIONS, CUSTOMERS & LOYALTY (flag/rate/membership/points/birthday/opt-out), STAFF (team, roles, announcements, leave, attendance), SETTINGS, EXPENSES, and deep analytics/forecasts. If the user can do it in the app, you have a tool for it.',
    'EXECUTIVE MARKETING & MODES you also fully control: create_campaign / message_customer (WhatsApp campaigns — targeted, scheduled, recurring, coupon-tracked), set_auto_promos (auto alerts on offers/featured/new items to members or everyone), set_winback ("we miss you"), set_followup (post-visit thanks + Google review), set_loyalty_mode (discounts vs perks + order thresholds), set_featured_config, set_member_card_design, set_menu_mode (full ordering vs display-only browse), set_waiter_call, set_cart_total_style, set_banner_fade, set_item_promo_tag, set_customer_optout, reorder_items. USE these decisively when the owner asks for marketing, loyalty, menu-mode or presentation changes — you are expected to execute large, precise, multi-step reconfigurations end-to-end.',
    `Persona: ${personaPrompt}`,
    `Role limit: ${modePrompt}`,
    cfg.handoverEnabled !== false ? 'If the customer demands a human manager or is extremely angry, end your reply with [HUMAN_HANDOVER_REQUIRED].' : '',
    'HOW YOU WORK — execution discipline (this is critical):',
    'E1) EXECUTE, do not narrate. When a change is requested, DO IT by calling the write tool(s) in the SAME response. Never reply with only a description or a promise ("now I will add…", "next I will…") without the matching tool call attached. At most a one-line plan, then act.',
    'E2) FINISH THE WHOLE TASK in one run. For bulk work ("add all of these", a spreadsheet, "clean the menu", "add a description to every item"), issue the tool calls for EVERY target — you may emit MANY tool calls in a single response — and keep going across steps until the task is 100% done. NEVER stop halfway to wait; the user must never have to say "continue/اكمل".',
    'E3) APPROVAL is handled by the app, NOT by you. Do NOT ask "do you confirm?" in chat before a write — just call the tool; the app shows the user an approve/deny prompt per write, and when Auto-run is ON it approves automatically and you must execute silently with no confirmation questions. Asking again in text only wastes their time. For a large destructive batch (many deletes), give ONE short heads-up line, then proceed.',
    'E4) NEVER INVENT DATA. Never guess or fabricate ids, image URLs, prices, or names. Use ONLY ids returned by a read tool (list_items, list_materials, list_categories, …) — call the matching list_* first if you lack them. You MAY pass a human-readable name (itemName / materialName / categoryName) to the write tools and it will be resolved to the correct id for you — prefer this over ids. NEVER set a placeholder or made-up image URL (e.g. "…/placeholder.png"); a product photo may ONLY be a URL returned by upload_attached_image / crop_and_upload_image, or one the user explicitly gave.',
    'E5) On a tool error, READ it and self-correct (re-list to get the real id, fix the field, resolve by name) — never repeat the same failing call.',
    'ATTACHMENTS — analyse and act:',
    '  • INVOICES/RECEIPTS: for each line, list_materials → add_material if missing → receive_stock (qty + cost) → finally log_expense for the invoice total (note "Invoice from [Supplier]").',
    '  • MENU IMAGES/LISTS: create the categories/items directly. Product photo from an attachment → DEFAULT upload_attached_image (whole image, NO crop) then set_item_image; use crop_and_upload_image ONLY when the user explicitly asks to crop; never crop on your own; never set imageIndex when passing an imageUrl.',
    '  • SPREADSHEETS: read each row and add_item / add_material with correct fields; summarise what was imported.',
    'MENU CRAFT: write appetising, authentic, CONCISE Arabic descriptions — no clichés, no repetition, no cheap/vulgar phrasing, no exclamation spam. Use correct serving words: فنجان only for espresso/small coffee; كوب or كاس for tea, iced and cold drinks (never call a glass drink "فنجان"). You CAN reorder the menu with reorder_items — e.g. strategy "images_first" to lead with photographed items, or pass an explicit order per category.',
    'ANALYST & ADVISOR — GROUNDED, NEVER HALLUCINATED: be a sharp business consultant for THIS venue specifically. Every strategy must cite ITS real numbers — pull them first (sales_report, top_items, menu_engineering, cogs_report, item_profitability, slow_movers, peak_hours, staff_performance, forecast_sales, customer_ltv, basket_analysis). For a weak-selling item use item_doctor (real 30-day sales, price vs category average, unused levers) then propose a concrete plan AND offer to execute it (fix photo/description, feature it, set pairings, adjust price, create an offer + a targeted campaign). Never invent a number; if data is thin, say so.',
    'FULL SYSTEM SUPPORT: you know this entire platform. For ANY "how do I / where is / what does X do" question from a manager or staffer, call help_guide first and answer precisely from it (screen names, exact steps). You are the venue\'s support line.',
    'LIVE MARKET AWARENESS: for questions about the outside market (competitor prices, trending dishes, seasonal demand, supplier costs, Saudi/GCC food trends) call market_research (real Google Search) — never answer market questions from memory. Combine what it returns with the venue\'s own numbers to make localized recommendations.',
    'MEMORY & LEARNING: You have durable memory. Use remember_fact to save useful lasting knowledge (a customer\'s preference/behaviour, a staff pattern, a standing decision, a menu convention, an approved strategy) and recall_facts to reuse it. Remembered facts are also injected in the snapshot below. Learn from each conversation and prefer remembering over re-asking.',
    `Reply in the user's language (Arabic/English). Clean markdown (short headings, bullets, tables for numbers). Currency: ${ctx.currency || 'SAR'}.`,
    `Live snapshot (JSON): ${JSON.stringify(ctx)}.`,
  ].filter(Boolean).join('\n')
}

// history: [{ role:'user'|'assistant', text }]
// attachments: [{ kind:'image'|'pdf'|'text', mime, data(base64) | text, name }] — attached to the latest user turn.
// onEvent({ type:'text'|'thought'|'action', ... }) streams turns to the UI.
// allow(action, args) => Promise<boolean> gates non-safe (write) actions.
// mode: 'fast' | 'deep' selects the model + reasoning depth.
export async function runAssistant({ tid, tenant, actor = '', history = [], attachments = [], onEvent, allow, mode = 'fast' }) {
  if (!firebaseReady) throw new Error('AI not configured')

  const cfg = tenant?.aiConfig || {}

  // 1. AI Enabled Guard
  if (cfg.enabled === false) {
    return 'عذراً، تم إيقاف المساعد الذكي إدارياً لهذه المنشأة.'
  }

  // 1b. Usage limits: platform-set per-venue caps (tenant.aiLimits {daily, monthly})
  // + purchased extra requests (tenant.aiExtra — credited by the platform after a
  // purchase). Counters live in aiMemory/_usage so any assistant user can bump them.
  {
    const limDaily = Number(tenant?.aiLimits?.daily) || 60
    const limMonthly = Number(tenant?.aiLimits?.monthly) || 900
    const extra = Number(tenant?.aiExtra) || 0
    const u = await getAiUsage(tid).catch(() => ({}))
    const today = new Date().toLocaleDateString('en-CA')
    const month = today.slice(0, 7)
    const dc = u.d === today ? Number(u.dc) || 0 : 0
    const mc = u.m === month ? Number(u.mc) || 0 : 0
    if (mc >= limMonthly + extra) {
      throw new Error(`استهلكت رصيد الشهر بالكامل (${limMonthly}${extra ? ` + ${extra} إضافي` : ''} طلباً). اضغط «شراء رصيد» أعلى المحادثة لطلب المزيد — يُفعَّل فور اعتماد الدفع.`)
    }
    if (dc >= limDaily) {
      throw new Error(`وصلت الحد اليومي للمساعد (${limDaily} طلباً) — يتجدد تلقائياً منتصف الليل، أو اطلب رفع الحد من «شراء رصيد».`)
    }
    bumpAiUsage(tid).catch(() => {})
  }

  // 2. Blocked Keywords Check
  const promptText = history[history.length - 1]?.text || ''
  if (cfg.blockedKeywords) {
    const keywords = cfg.blockedKeywords.split(',').map((k) => k.trim()).filter(Boolean)
    for (const word of keywords) {
      if (promptText.toLowerCase().includes(word.toLowerCase())) {
        return `عذراً، تحتوي رسالتك على كلمة محظورة إدارياً (${word})، يرجى تعديل استفسارك.`
      }
    }
  }

  // 3. Operating Hours Guard
  if (cfg.operatingHours && cfg.operatingHours !== 'all') {
    const currentHour = new Date().getHours()
    const isWorkingHours = currentHour >= 8 && currentHour <= 23 // Standard 8 AM to 11 PM working hours
    if (cfg.operatingHours === 'working' && !isWorkingHours) {
      return 'المساعد الذكي غير متاح حالياً (متوفر فقط خلال ساعات العمل الرسمية من 8 صباحاً حتى 11 مساءً).'
    }
    if (cfg.operatingHours === 'non-working' && isWorkingHours) {
      return 'المساعد الذكي غير متاح حالياً (متوفر فقط خارج ساعات العمل الرسمية).'
    }
  }

  // 4. Emulate Delay (Human Typing effect)
  if (cfg.delayEnabled) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  // 5. Privacy Masking
  let cleanPrompt = promptText
  if (cfg.privacyMasking !== false) {
    // Mask credit cards and phone numbers
    cleanPrompt = cleanPrompt.replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, '[CARD_MASKED]')
    cleanPrompt = cleanPrompt.replace(/\b(05\d{8}|\+9665\d{8})\b/g, '[PHONE_MASKED]')
  }

  // 6. Token/Invocation Limits check
  if (tid) {
    const logsRef = collection(db, 'tenants', tid, 'aiLog')
    const allLogs = await getDocs(logsRef).catch(() => ({ docs: [] }))
    const logsData = allLogs.docs.map((d) => d.data())
    
    const now = Date.now()
    const startOfDay = new Date().setHours(0, 0, 0, 0)
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
    
    const dailyCount = logsData.filter((l) => l.at >= startOfDay).length
    const monthlyCount = logsData.filter((l) => l.at >= startOfMonth).length
    
    const maxDaily = cfg.limitDaily ?? 100
    const maxMonthly = cfg.limitMonthly ?? 3000
    
    if (dailyCount >= maxDaily) {
      return 'عذراً، تم تجاوز الحد اليومي المسموح به لاستعلامات المساعد الذكي لهذه المنشأة.'
    }
    if (monthlyCount >= maxMonthly) {
      return 'عذراً، تم تجاوز الحد الشهري المسموح به لاستعلامات المساعد الذكي لهذه المنشأة.'
    }
  }

  // 7. Custom Model Choice — Gemini 1.5 models were retired from the v1beta API
  // (generateContent → 404), so ignore any stale saved 1.5 config and use current.
  let model = cfg.model || AI_MODELS[mode] || AI_MODELS.fast
  if (/gemini-1\.5/i.test(model)) model = AI_MODELS[mode] || AI_MODELS.fast

  // The live snapshot + the venue's measured brand profile are gathered in
  // parallel. The brand profile is best-effort: any failure (or a venue with no
  // type set) simply leaves it null and the prompt degrades to its old wording.
  const [ctx, insight] = await Promise.all([
    buildContext(tid, tenant).catch(() => ({})),
    (tenant?.type
      ? Promise.all([listItems(tid).catch(() => []), listCategories(tid).catch(() => [])])
        .then(([items, categories]) => analyzeBrand({ tenant, items, categories }))
        .catch(() => null)
      : Promise.resolve(null)),
  ])
  const sys = systemPrompt(ctx, cfg, tenant, insight)
  // Same tools, same parameters — described in this venue's vocabulary.
  const toolDecls = toolDeclarationsFor(tenant) || TOOL_DECLARATIONS

  // Build the model turns from the visible history. This MUST be sanitized or a
  // single bad turn silently breaks the whole conversation:
  //  • drop empty/roleless messages — an empty text part makes Gemini 400 (a past
  //    empty assistant reply used to poison every later message → "no response").
  //  • merge consecutive same-role turns — Gemini requires user/model to alternate.
  //  • the transcript must START with a user turn.
  const turns = []
  for (const m of history) {
    const role = m.role === 'assistant' ? 'model' : (m.role === 'user' ? 'user' : null)
    const txt = (m.text || '').trim()
    if (!role || !txt) continue
    const prev = turns[turns.length - 1]
    if (prev && prev.role === role) prev.parts[0].text += `\n\n${txt}`
    else turns.push({ role, parts: [{ text: txt }] })
  }
  while (turns.length && turns[0].role === 'model') turns.shift()
  const contents = turns

  // The final user turn carries the (privacy-masked) current prompt.
  if (contents.length && contents[contents.length - 1].role === 'user') {
    contents[contents.length - 1].parts[0].text = cleanPrompt
  } else {
    contents.push({ role: 'user', parts: [{ text: cleanPrompt || '…' }] })
  }

  // Attach files/images to the most recent user message so the model can analyse them.
  if (attachments.length) {
    const last = contents[contents.length - 1]
    if (last && last.role === 'user') {
      attachments.forEach((a) => {
        // A PDF is delivered as rasterised page-images (+ any extracted text) so
        // that graphic menus and huge files both fit the inline request cap.
        if (a.kind === 'pdf' && Array.isArray(a.pages) && a.pages.length) {
          last.parts.push({ text: `\n\n[ملف PDF: ${a.name}${a.note ? ' — ' + a.note : ''}] (مُرفَق كصور صفحات${a.text ? ' + نص مستخرج' : ''})` })
          if (a.text) last.parts.push({ text: a.text })
          a.pages.forEach((p) => last.parts.push({ inlineData: { mimeType: p.mime, data: p.data } }))
        } else if ((a.kind === 'image' || a.kind === 'pdf') && a.data) {
          last.parts.push({ inlineData: { mimeType: a.mime, data: a.data } })
        } else if (a.kind === 'text' && a.text) {
          last.parts.push({ text: `\n\n[Attached file: ${a.name}]\n${a.text}` })
        }
      })
    }
  }

  const genCfg = mode === 'deep' ? { thinkingConfig: { includeThoughts: true } } : {}
  const proxy = httpsCallable(functions, 'geminiProxy')

  // A transient upstream hiccup (model overloaded / rate-limited / gateway) is
  // worth an automatic retry — unlike a 400/permission error which never succeeds.
  const isTransient = (s) => /(429|500|502|503|504|unavailable|overload|high demand|rate.?limit|quota|exhausted|timeout|deadline|try again)/i.test(String(s || ''))

  // Never let a request hang forever (spinner with no reply). A stuck proxy/fetch
  // becomes a transient timeout error → retried, then surfaced.
  const withTimeout = (p, ms, label) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => { const e = new Error(`AI timeout (${label})`); e.transient = true; rej(e) }, ms)),
  ])

  // One request: geminiProxy first (prod), then a direct call if a local key exists.
  const sendGemini = async (useModel, body) => {
    try {
      const res = await withTimeout(proxy({ model: useModel, body }), 55000, 'proxy')
      return res.data
    } catch (e) {
      const localKey = import.meta.env.VITE_GEMINI_API_KEY
      if (!localKey) {
        const err = new Error(`AI error: ${e?.message || e}. (للتشغيل يرجى نشر الدوال السحابية عبر الأمر: firebase deploy --only functions أو أضف VITE_GEMINI_API_KEY في ملف .env.local للتجربة المحلية)`)
        err.transient = e?.transient || isTransient(e?.message) || isTransient(e?.code)
        throw err
      }
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${localKey}`
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 55000)
      let fetchRes
      try {
        fetchRes = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal })
      } catch (fe) {
        const err = new Error(`AI request failed: ${fe?.name === 'AbortError' ? 'timeout' : (fe?.message || fe)}`)
        err.transient = true
        throw err
      } finally { clearTimeout(timer) }
      if (!fetchRes.ok) {
        const t = await fetchRes.text().catch(() => '')
        const err = new Error(`AI error (direct): ${fetchRes.status} - ${t.slice(0, 180)}`)
        err.transient = isTransient(fetchRes.status) || isTransient(t)
        throw err
      }
      return await fetchRes.json()
    }
  }

  // Retry transient overloads with exponential backoff; if the primary tier stays
  // overloaded, fall back once to the other tier (flash <-> pro use separate pools).
  const requestWithRetry = async (body) => {
    const fallback = model === AI_MODELS.deep ? AI_MODELS.fast : AI_MODELS.deep
    const chain = fallback && fallback !== model ? [model, fallback] : [model]
    let lastErr
    for (let ci = 0; ci < chain.length; ci++) {
      const tries = ci === 0 ? 3 : 2
      for (let n = 0; n < tries; n++) {
        try { return await sendGemini(chain[ci], body) } catch (e) {
          lastErr = e
          if (!e?.transient) throw e
          if (ci === 0 && n === 0) onEvent?.({ type: 'thought', text: 'النموذج مزدحم مؤقتاً — إعادة المحاولة تلقائياً…' })
          if (ci === chain.length - 1 && n === tries - 1) break
          await new Promise((r) => setTimeout(r, 600 * Math.pow(2, n) + Math.floor(Math.random() * 250)))
        }
      }
    }
    throw lastErr || new Error('AI error')
  }

  // Budget for multi-step tool loops. Bulk tasks (import a whole menu, add a
  // description to every item) need many sequential tool rounds; 14 was far too
  // few and forced the user to keep typing "continue". The model still stops
  // itself as soon as the task is done (a turn with no tool calls returns).
  for (let step = 0; step < 48; step++) {
    const body = { systemInstruction: { parts: [{ text: sys }] }, contents, tools: [{ functionDeclarations: toolDecls }], ...(Object.keys(genCfg).length ? { generationConfig: genCfg } : {}) }
    const json = await requestWithRetry(body)

    const parts = json.candidates?.[0]?.content?.parts || []
    const thoughts = parts.filter((p) => p.text && p.thought).map((p) => p.text).join('').trim()
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim()
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall)
    if (thoughts) onEvent?.({ type: 'thought', text: thoughts })
    if (text) onEvent?.({ type: 'text', text })
    // No more tool calls → the turn is done. The UI renders ONLY what onEvent emits
    // (the return value is discarded), so if the model's final turn is empty (common
    // right after a run of tool calls) we MUST emit a confirmation — otherwise it
    // looked like "no reply".
    if (!calls.length) {
      if (!text) {
        const didWork = step > 0
        const fb = didWork ? 'تم تنفيذ ما طلبت. هل تحتاج أي شيء آخر؟' : 'تم. هل تحتاج أي شيء آخر؟'
        onEvent?.({ type: 'text', text: fb })
        return fb
      }
      return cfg.sandbox ? `[وضع الاختبار التجريبي]\n${text}` : text
    }

    contents.push({ role: 'model', parts })
    const responses = []
    for (const call of calls) {
      const action = ACTIONS_BY_NAME[call.name]
      if (!action) { responses.push({ functionResponse: { name: call.name, response: { error: 'unknown tool' } } }); continue }
      const args = call.args || {}
      if (action.risk !== 'safe' && allow && !(await allow(action, args))) {
        onEvent?.({ type: 'action', name: call.name, args, risk: action.risk, skipped: true })
        responses.push({ functionResponse: { name: call.name, response: { skipped: 'user did not approve' } } })
        continue
      }
      onEvent?.({ type: 'action', name: call.name, args, risk: action.risk })
      let result
      try { result = await action.run(args, { tid, actor, tenant, attachments }) } catch (e) { result = { error: String(e?.message || e) } }
      if (action.risk !== 'safe') logAi(tid, { action: call.name, args, by: actor, ok: !result?.error }).catch(() => {})
      onEvent?.({ type: 'action-result', name: call.name, result })
      responses.push({ functionResponse: { name: call.name, response: { result } } })
    }
    contents.push({ role: 'user', parts: responses })
  }
  // Hit the step ceiling on a very large task — tell the user honestly (emitted so
  // the UI shows it; the return value alone is not rendered).
  const capMsg = 'أنجزت جزءاً كبيراً من المهمة. إن بقيت خطوات، اكتب «أكمل» وسأتابع من حيث توقفت.'
  onEvent?.({ type: 'text', text: capMsg })
  return capMsg
}

