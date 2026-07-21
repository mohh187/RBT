// Platform-owner AI analyst helpers.
// - askAssistant(): sends an Arabic analyst prompt + a compact context summary to
//   the existing `geminiProxy` Cloud Function callable and returns the model's text.
// - askExecutive(): the EXECUTIVE agent loop — cross-venue authority, executes
//   real actions through the platformAiActions.js tool registry (modeled on the
//   venue assistant loop in aiBridge.js: sanitized turns, timeout, retry with
//   flash<->pro fallback, multi-step function-calling).
// - groupErrors(): pure function that buckets platformErrors into recurring
//   signatures (error grouping — suggestion 61).
import { functions, firebaseReady } from './firebase.js'
import { httpsCallable } from 'firebase/functions'
import { runPlatformTool, platformToolDeclarations } from './platformAiActions.js'

const SYSTEM_INSTRUCTION = `أنت "المحلّل الذكي" لمالك منصّة RBT360 (نظام قوائم ومطاعم متعدّد المنشآت).
مهمتك مساعدة مالك المنصّة على فهم بيانات المنصّة كاملةً: عدد المنشآت، الاشتراكات والخطط،
الإيرادات والطلبات الأخيرة، والأخطاء المتكرّرة. أجب دائماً باللغة العربية بأسلوب موجز واحترافي،
واستند فقط إلى البيانات المُعطاة في "ملخّص السياق". إذا كانت البيانات غير كافية للإجابة فاذكر ذلك
بوضوح واقترح ما الذي يلزم لمعرفته. قدّم أرقاماً وتوصيات عملية عند الإمكان، وتجنّب اختلاق معلومات.`

// Build the final prompt text out of the system instruction, the caller-supplied
// context summary, and the actual question.
function buildPrompt(question, contextSummary) {
  return [
    SYSTEM_INSTRUCTION,
    '',
    '=== ملخّص السياق (بيانات المنصّة الحالية) ===',
    (contextSummary || 'لا يوجد سياق متاح.').trim(),
    '',
    '=== سؤال مالك المنصّة ===',
    String(question || '').trim(),
  ].join('\n')
}

// Defensively pull the answer text out of a Gemini generateContent response.
function extractText(data) {
  try {
    const parts = data?.candidates?.[0]?.content?.parts
    if (Array.isArray(parts)) {
      const text = parts
        .filter((p) => p && typeof p.text === 'string' && !p.thought)
        .map((p) => p.text)
        .join('')
        .trim()
      if (text) return text
    }
    // Blocked / empty candidate — surface a readable reason if present.
    const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason
    if (reason) return `تعذّر توليد إجابة (السبب: ${reason}).`
  } catch { /* fall through */ }
  return ''
}

// Ask the analyst assistant. Returns the answer string, or throws with an
// Arabic-friendly message the UI can display.
export async function askAssistant(question, contextSummary) {
  if (!functions) throw new Error('الدوال السحابية غير مهيّأة (Firebase Functions غير متاح).')
  const q = String(question || '').trim()
  if (!q) throw new Error('اكتب سؤالاً أولاً.')

  const prompt = buildPrompt(q, contextSummary)
  const proxy = httpsCallable(functions, 'geminiProxy')
  let data
  try {
    const res = await proxy({
      model: 'gemini-2.5-flash',
      body: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      },
    })
    data = res?.data
  } catch (e) {
    const msg = e?.message || String(e)
    throw new Error(
      `تعذّر الاتصال بالمساعد: ${msg}. تأكّد من نشر دالة geminiProxy ووجود مفتاح GEMINI_API_KEY على الخادم، ومن أنّ المستخدم الحالي له دور owner/manager لإحدى المنشآت.`
    )
  }
  const text = extractText(data)
  if (!text) throw new Error('لم يُرجِع المساعد أي نص. حاول مجدّداً أو أعد صياغة السؤال.')
  return text
}

// ---- Error grouping (suggestion 61) ----------------------------------------
// Pure function: buckets an array of platformErrors docs by a signature derived
// from the first 80 chars of the message. Returns
// [{ sig, count, sample, lastAt }] sorted by count desc (ties → most recent).
export function groupErrors(errors) {
  const list = Array.isArray(errors) ? errors : []
  const buckets = new Map()
  for (const e of list) {
    if (!e) continue
    const raw = typeof e.message === 'string' ? e.message : String(e.message || '')
    const sig = (raw.replace(/\s+/g, ' ').trim().slice(0, 80)) || '(بدون رسالة)'
    const atMs = e.at?.toMillis?.() ?? (e.at ? new Date(e.at).getTime() : 0) ?? 0
    const b = buckets.get(sig)
    if (b) {
      b.count += 1
      if (atMs >= b.lastMs) { b.lastMs = atMs; b.lastAt = e.at; b.sample = e }
    } else {
      buckets.set(sig, { sig, count: 1, sample: e, lastAt: e.at, lastMs: atMs })
    }
  }
  return Array.from(buckets.values())
    .map(({ sig, count, sample, lastAt }) => ({ sig, count, sample, lastAt }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      const am = a.lastAt?.toMillis?.() ?? 0
      const bm = b.lastAt?.toMillis?.() ?? 0
      return bm - am
    })
}

// ---- Executive assistant (platform owner, cross-venue, with real tools) -----

// 'gemini-2.5-pro' was retired by Google (404 on use, though still listed).
// Both ids verified against the live API.
const EXEC_MODELS = { fast: 'gemini-2.5-flash', deep: 'gemini-pro-latest' }

const EXEC_SYSTEM = [
  'أنت «المساعد التنفيذي الأعلى» لمالك منصة rbt360 — منصة قوائم ومطاعم متعددة المنشآت. تعمل بصلاحية المالك الكاملة على المنصة بأكملها: كل المنشآت، الاشتراكات، الفوترة، النطاقات، التعاميم، الدعم، ومراقبة الأخطاء.',
  'الجمهور: مالك المنصة نفسه، وله حق الاطلاع على بيانات جميع المنشآت داخل هذه الجلسة. ومع ذلك يمنع منعاً باتاً تمرير بيانات منشأة إلى منشأة أخرى أو إلى أي طرف خارجي: رسائل send_venue_message والتعاميم يجب ألا تتضمن أبداً أرقام أو أسماء أو أسرار منشأة أخرى.',
  'أنت محلل حاد ومنفذ حازم في آن واحد:',
  'E1) نفّذ ولا تكتفِ بالوصف: عند طلب تغيير استدعِ الأداة المناسبة في نفس الرد، ولا تعد بالتنفيذ لاحقاً.',
  'E2) حلّل بالأرقام الحقيقية فقط: قبل أي توصية استدعِ أدوات القراءة (platform_stats، top_venues، venues_at_risk، revenue_by_plan، error_report، list_support_issues…). لا تخترع رقماً أو اسم منشأة أبداً؛ إن كانت البيانات ناقصة فقلها صراحة.',
  'E3) تحديد المنشآت بالاسم: مرر الاسم كما كتبه المالك وستتولى الأدوات المطابقة الذكية (عربي/إنجليزي/slug). إن أعادت الأداة قائمة مرشحين (ambiguous) فاعرضها على المالك واسأله أيها يقصد — لا تنفذ على تخمين إطلاقاً.',
  'E4) الإجراءات الحساسة (إيقاف منشأة، تغيير خطة، تعميم عام): إن كانت رسالة المالك الأخيرة أمراً صريحاً مباشراً بها فنفذ فوراً دون سؤال؛ وإلا فلخص ما ستفعله واطلب تأكيداً واحداً قصيراً قبل الاستدعاء.',
  'E5) عند فشل أداة اقرأ رسالة الخطأ وصحح مسارك (مثلاً استدعِ list_venues لمعرفة الاسم الصحيح) ولا تكرر نفس الاستدعاء الفاشل.',
  'E6) أكمل المهمة كلها في جولة واحدة: للمهام المتعددة (مثلاً «مدد لكل من يستحق») نفذ كل الاستدعاءات اللازمة تباعاً حتى النهاية.',
  'أجب دائماً بالعربية وبالأرقام اللاتينية فقط (1 2 3 — لا أرقام هندية)، بأسلوب موجز واحترافي، وبماركداون نظيف: عناوين قصيرة، نقاط، وجداول للأرقام. اختم كل تنفيذ بملخص واضح لما تم.',
].join('\n')

// Transient upstream hiccups worth retrying (vs 400/permission which never heal).
const isTransientErr = (s) => /(429|500|502|503|504|unavailable|overload|high demand|rate.?limit|quota|exhausted|timeout|deadline|try again)/i.test(String(s || ''))

const withTimeout = (p, ms, label) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => { const e = new Error(`AI timeout (${label})`); e.transient = true; rej(e) }, ms)),
])

// One request: geminiProxy first (prod), then a direct call if a local key exists
// (same key/env access pattern as aiBridge.js — nothing hardcoded).
async function sendExecGemini(model, body) {
  const localKey = import.meta.env.VITE_GEMINI_API_KEY
  if (functions) {
    try {
      const res = await withTimeout(httpsCallable(functions, 'geminiProxy')({ model, body }), 55000, 'proxy')
      return res.data
    } catch (e) {
      if (!localKey) {
        const err = new Error(`AI error: ${e?.message || e}. (انشر الدوال السحابية geminiProxy أو أضف VITE_GEMINI_API_KEY في .env.local للتجربة المحلية)`)
        err.transient = e?.transient || isTransientErr(e?.message) || isTransientErr(e?.code)
        throw err
      }
      // fall through to the direct call below
    }
  }
  if (!localKey) throw new Error('المساعد غير مهيأ: انشر دالة geminiProxy أو أضف VITE_GEMINI_API_KEY في .env.local.')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${localKey}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 55000)
  let res
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal })
  } catch (fe) {
    const err = new Error(`AI request failed: ${fe?.name === 'AbortError' ? 'timeout' : (fe?.message || fe)}`)
    err.transient = true
    throw err
  } finally { clearTimeout(timer) }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    const err = new Error(`AI error (direct): ${res.status} - ${t.slice(0, 180)}`)
    err.transient = isTransientErr(res.status) || isTransientErr(t)
    throw err
  }
  return await res.json()
}

// Retry transient overloads with backoff; if the primary tier stays overloaded,
// fall back once to the other tier (flash <-> pro use separate capacity pools).
async function execRequestWithRetry(model, body, onEvent) {
  const fallback = model === EXEC_MODELS.fast ? EXEC_MODELS.deep : EXEC_MODELS.fast
  const chain = [model, fallback]
  let lastErr
  for (let ci = 0; ci < chain.length; ci++) {
    const tries = ci === 0 ? 3 : 2
    for (let n = 0; n < tries; n++) {
      try { return await sendExecGemini(chain[ci], body) } catch (e) {
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

// The executive agent loop.
// history: [{ role:'user'|'assistant', text }] (the visible chat, latest user turn = prompt)
// context: compact live platform summary string (appended to the system prompt)
// onEvent({ type:'text'|'thought'|'action'|'action-result', ... }) streams turns to the UI
// user: the auth user ({ uid, email }) — stamped on chat messages + the audit trail
export async function askExecutive({ history = [], prompt, context = '', onEvent, user = null, actor = '' } = {}) {
  if (!firebaseReady && !import.meta.env.VITE_GEMINI_API_KEY) throw new Error('المساعد غير مهيأ (إعدادات Firebase ناقصة).')
  const q = String(prompt || '').trim()
  if (!q) throw new Error('اكتب طلباً أولاً.')

  const sys = context && context.trim()
    ? `${EXEC_SYSTEM}\n\n=== ملخص حي لبيانات المنصة الآن ===\n${context.trim()}`
    : EXEC_SYSTEM

  // Sanitize the visible history into alternating Gemini turns (same rules as
  // aiBridge.js): drop empty/roleless turns, merge consecutive same-role turns,
  // and make sure the transcript starts with a user turn.
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
  if (contents.length && contents[contents.length - 1].role === 'user') {
    contents[contents.length - 1].parts[0].text = q
  } else {
    contents.push({ role: 'user', parts: [{ text: q }] })
  }

  const decls = platformToolDeclarations()
  const toolCtx = { cache: {}, user, actor }

  for (let step = 0; step < 30; step++) {
    const body = { systemInstruction: { parts: [{ text: sys }] }, contents, tools: [{ functionDeclarations: decls }] }
    const json = await execRequestWithRetry(EXEC_MODELS.fast, body, onEvent)

    const parts = json?.candidates?.[0]?.content?.parts || []
    const thoughts = parts.filter((p) => p.text && p.thought).map((p) => p.text).join('').trim()
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim()
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall)
    if (thoughts) onEvent?.({ type: 'thought', text: thoughts })
    if (text) onEvent?.({ type: 'text', text })

    // No more tool calls -> the turn is done. The UI renders what onEvent emits,
    // so an empty final turn (common right after tool calls) must still emit.
    if (!calls.length) {
      if (!text) {
        const fb = step > 0 ? 'تم تنفيذ ما طلبت. هل تحتاج شيئاً آخر؟' : extractText(json) || 'لم يصلني رد واضح — أعد صياغة الطلب من فضلك.'
        onEvent?.({ type: 'text', text: fb })
        return fb
      }
      return text
    }

    contents.push({ role: 'model', parts })
    const responses = []
    for (const call of calls) {
      const args = call.args || {}
      onEvent?.({ type: 'action', name: call.name, args })
      const result = await runPlatformTool(call.name, args, toolCtx)
      onEvent?.({ type: 'action-result', name: call.name, result })
      responses.push({ functionResponse: { name: call.name, response: { result } } })
    }
    contents.push({ role: 'user', parts: responses })
  }

  const capMsg = 'أنجزت جزءاً كبيراً من المهمة. إن بقيت خطوات، اكتب «أكمل» وسأتابع من حيث توقفت.'
  onEvent?.({ type: 'text', text: capMsg })
  return capMsg
}
