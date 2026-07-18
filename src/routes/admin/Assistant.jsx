import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import Icon from '../../components/Icon.jsx'
import Markdown from '../../components/Markdown.jsx'
import { runAssistant, aiConfigured } from '../../lib/aiBridge.js'
import { getAiUsage } from '../../lib/db.js'
import { createIssue } from '../../lib/platform.js'
import { listChats, getChat, saveChat, deleteChat, newChatId } from '../../lib/aiChats.js'
import { fileToAttachment, ACCEPT } from '../../lib/aiFiles.js'
import Sheet from '../../components/Sheet.jsx'
import { useToast } from '../../components/Toast.jsx'

// Slash commands / quick prompts.
const COMMANDS = [
  { k: 'sales', icon: 'trending', ar: 'مبيعات اليوم', en: "Today's sales", p: { ar: 'أعطني ملخص مبيعات اليوم', en: "Give me today's sales summary" } },
  { k: 'lowstock', icon: 'inventory', ar: 'المخزون المنخفض', en: 'Low stock', p: { ar: 'ما هي المواد المنخفضة التي تحتاج إعادة طلب؟', en: 'Which materials are low and need reordering?' } },
  { k: 'inventory', icon: 'store', ar: 'ملخص المخزون', en: 'Inventory summary', p: { ar: 'أعطني ملخصاً لحالة المخزون الحالية', en: 'Summarize the current inventory' } },
  { k: 'top', icon: 'award', ar: 'الأكثر مبيعاً', en: 'Top items', p: { ar: 'ما هي الأصناف الأكثر مبيعاً؟', en: 'What are the top-selling items?' } },
  { k: 'peak', icon: 'clock', ar: 'ساعات الذروة', en: 'Peak hours', p: { ar: 'ما هي ساعات الذروة لدينا؟', en: 'What are our peak hours?' } },
  { k: 'orders', icon: 'cart', ar: 'الطلبات النشطة', en: 'Active orders', p: { ar: 'ما هي الطلبات النشطة الآن؟', en: 'What orders are active right now?' } },
  { k: 'profit', icon: 'wallet', ar: 'صافي الربح', en: 'Net profit', p: { ar: 'أعطني تقرير صافي الربح بعد المصروفات', en: 'Give me the net profit report after expenses' } },
  { k: 'purchase', icon: 'repeat', ar: 'أمر شراء مقترح', en: 'Purchase order', p: { ar: 'اقترح أمر شراء للمواد الناقصة', en: 'Suggest a purchase order for the low materials' } },
  { k: 'members', icon: 'award', ar: 'ملخص الولاء', en: 'Loyalty summary', p: { ar: 'أعطني ملخص برنامج الولاء والأعضاء', en: 'Summarize the loyalty program and members' } },
  { k: 'cogs', icon: 'reports', ar: 'تكلفة البضاعة', en: 'COGS report', p: { ar: 'أعطني تقرير تكلفة البضاعة المباعة', en: 'Give me the COGS report' } },
]

// Streaming-style reveal: shows plain text while "typing" (no mid-token markdown
// artifacts), then renders full markdown once complete — the Claude/Gemini feel.
function TypeText({ text, onTick }) {
  const [n, setN] = useState(0)
  const [done, setDone] = useState(false)
  useEffect(() => {
    let i = 0
    const step = Math.max(1, Math.ceil(text.length / 70))
    const id = setInterval(() => {
      i += step
      if (i >= text.length) { setN(text.length); setDone(true); clearInterval(id) } else setN(i)
      onTick?.()
    }, 16)
    return () => clearInterval(id)
  }, [text])
  return done ? <Markdown text={text} /> : <span style={{ whiteSpace: 'pre-wrap' }}>{text.slice(0, n)}</span>
}

// Collapsible reasoning panel (Deep mode "thinking").
function Thought({ text, ar }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="ai-thought">
      <button className="ai-thought-h" onClick={() => setOpen((o) => !o)}><Icon name="sparkles" size={13} /> {ar ? 'التفكير' : 'Reasoning'} <Icon name={open ? 'moon' : 'next'} size={12} /></button>
      {open && <div className="ai-thought-b"><Markdown text={text} /></div>}
    </div>
  )
}

// Live «جارٍ التنفيذ» ticker beside a running tool call — seconds since start.
function RunningTimer({ since, ar }) {
  const [, setTick] = useState(0)
  useEffect(() => { const iv = setInterval(() => setTick((t) => t + 1), 500); return () => clearInterval(iv) }, [])
  const s = since ? (Date.now() - since) / 1000 : 0
  return <span className="xs num" style={{ color: 'var(--brand)', fontWeight: 700 }}> · {ar ? 'جارٍ التنفيذ' : 'running'} {s.toFixed(0)}{ar ? ' ث' : 's'}</span>
}

export default function Assistant() {
  const { lang } = useI18n()
  const { tenantId, tenant, profile } = useAuth()
  const toast = useToast()
  const ar = lang === 'ar'
  const actor = profile?.displayName || profile?.email || ''
  const p = (cmd) => (ar ? cmd.p.ar : cmd.p.en)

  const [chatId, setChatId] = useState(null)
  const [chats, setChats] = useState([])
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('fast') // 'fast' | 'deep'
  const [pending, setPending] = useState(null) // { name, args, risk, resolve }
  const [sideOpen, setSideOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 821 : true))
  const [hl, setHl] = useState(0)
  const [atts, setAtts] = useState([]) // pending attachments for the next message
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [autoRun, setAutoRun] = useState(false) // auto-approve non-destructive write actions

  const scrollRef = useRef(null)
  const taRef = useRef(null)
  const fileRef = useRef(null)
  const autoRunRef = useRef(false)
  useEffect(() => { autoRunRef.current = autoRun }, [autoRun])
  const scrollDown = () => setTimeout(() => { const s = scrollRef.current; if (s) s.scrollTop = s.scrollHeight }, 30)

  useEffect(() => { if (tenantId) setChats(listChats(tenantId)) }, [tenantId])

  // slash palette
  const slash = /^\/(\S*)$/.exec(input.trim())
  const cmdMatches = useMemo(() => {
    if (!slash) return []
    const q = slash[1].toLowerCase()
    return COMMANDS.filter((c) => !q || c.k.includes(q) || c.ar.includes(q) || c.en.toLowerCase().includes(q))
  }, [input])
  useEffect(() => { setHl(0) }, [input])

  const persist = (msgs, id) => {
    if (!tenantId || !id) return
    const clean = msgs.map(({ resolve, stream, ...m }) => m)
    saveChat(tenantId, { id, messages: clean })
    setChats(listChats(tenantId))
  }

  const newChat = () => { setChatId(null); setMessages([]); setPending(null); setInput(''); if (window.innerWidth < 821) setSideOpen(false); taRef.current?.focus() }
  const loadChat = (id) => {
    const c = getChat(tenantId, id)
    if (!c) return
    setChatId(id); setMessages(c.messages || []); setPending(null)
    if (window.innerWidth < 821) setSideOpen(false)
    scrollDown()
  }
  const removeChat = (e, id) => {
    e.stopPropagation()
    deleteChat(tenantId, id); setChats(listChats(tenantId))
    if (id === chatId) newChat()
  }

  const requestApproval = (action, args) => {
    // auto-run approves ordinary writes ('confirm'); destructive ('danger') always asks.
    if (autoRunRef.current && action.risk !== 'danger') return Promise.resolve(true)
    return new Promise((resolve) => setPending({ name: action.name, args, risk: action.risk, resolve }))
  }
  const decide = (ok) => { pending?.resolve(ok); setPending(null) }

  const send = async (raw) => {
    const text = (raw ?? input).trim()
    const sendAtts = raw != null ? [] : atts // chips/commands carry no files
    if ((!text && !sendAtts.length) || busy) return
    setInput(''); if (raw == null) setAtts([]); if (taRef.current) taRef.current.style.height = 'auto'

    let id = chatId
    if (!id) { id = newChatId(); setChatId(id) }

    const files = sendAtts.map((a) => ({ name: a.name, kind: a.kind, preview: a.preview || '' }))
    const userMsg = { role: 'user', text, ...(files.length ? { files } : {}) }

    if (!aiConfigured()) {
      const next = [...messages, userMsg, { role: 'assistant', text: ar ? 'المساعد غير مُفعّل. أضِف `VITE_GEMINI_API_KEY` في `.env.local` ثم أعد التشغيل.' : 'Assistant not configured. Add `VITE_GEMINI_API_KEY` to `.env.local` and restart.' }]
      setMessages(next); persist(next, id); return
    }

    const promptText = text || (ar ? 'حلّل المرفقات التالية.' : 'Analyze the attached files.')
    await execute(promptText, messages, userMsg, id, sendAtts)
  }

  // shared model run — used by send(), regenerate() and edit-resend, so all
  // three paths share the exact same event loop and persistence
  const execute = async (promptText, baseMsgs, userMsg, id, sendAtts) => {
    const history = [...baseMsgs.filter((m) => m.role), { role: 'user', text: promptText }]
    const afterUser = [...baseMsgs, userMsg]
    setMessages(afterUser); persist(afterUser, id)
    setBusy(true); scrollDown()

    const collected = [...afterUser]
    const push = (msg) => { collected.push(msg); setMessages([...collected]); scrollDown() }
    try {
      await runAssistant({
        tid: tenantId, tenant, actor, history, mode, attachments: sendAtts,
        onEvent: (e) => {
          if (e.type === 'text') push({ role: 'assistant', text: e.text, stream: true })
          else if (e.type === 'thought') push({ type: 'thought', text: e.text })
          else if (e.type === 'action-result') {
            for (let j = collected.length - 1; j >= 0; j--) { if (collected[j].type === 'action' && collected[j].name === e.name && collected[j].result === undefined) { collected[j] = { ...collected[j], result: e.result, tookMs: collected[j].startedAt ? Date.now() - collected[j].startedAt : null }; break } }
            setMessages([...collected]); scrollDown()
          } else push({ type: 'action', name: e.name, args: e.args, risk: e.risk, skipped: e.skipped, startedAt: Date.now() })
        },
        allow: requestApproval,
      })
    } catch (e) {
      push({ role: 'assistant', text: `خطأ: ${String(e?.message || e)}` })
    } finally {
      setBusy(false); persist(collected, id); scrollDown()
    }
  }

  // ----- message tools: copy / regenerate / edit-resend (user request) -----
  const copyMsg = async (m) => {
    try { await navigator.clipboard.writeText(m.text || ''); toast.success(ar ? 'نُسخ النص' : 'Copied') } catch (_) { toast.error(ar ? 'تعذّر النسخ' : 'Copy failed') }
  }
  // index of the last USER message — regenerate replays it, dropping what followed
  const lastUserIdx = (() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return i; return -1 })()
  const regenerate = () => {
    if (busy || lastUserIdx < 0) return
    const um = messages[lastUserIdx]
    // original binary attachments aren't persisted — the replay is text-only
    execute(um.text || (ar ? 'حلّل المرفقات التالية.' : 'Analyze the attached files.'), messages.slice(0, lastUserIdx), um, chatId, [])
  }
  const editUserMsg = (i) => {
    if (busy) return
    setInput(messages[i].text || '')
    const base = messages.slice(0, i)
    setMessages(base); persist(base, chatId)
    taRef.current?.focus()
  }

  // ----- attachment LIBRARY: every file/image from every conversation -----
  const [libOpen, setLibOpen] = useState(false)
  // ---- usage meter + buy-credits ----
  const [usage, setUsage] = useState(null) // {d, dc, m, mc}
  const [buyOpen, setBuyOpen] = useState(false)
  const [buyBusy, setBuyBusy] = useState(false)
  const limits = { daily: Number(tenant?.aiLimits?.daily) || 60, monthly: Number(tenant?.aiLimits?.monthly) || 900 }
  const aiExtra = Number(tenant?.aiExtra) || 0
  const today = new Date().toLocaleDateString('en-CA')
  const usageNorm = usage ? { dc: usage.d === today ? Number(usage.dc) || 0 : 0, mc: usage.m === today.slice(0, 7) ? Number(usage.mc) || 0 : 0 } : null
  const usagePct = usageNorm ? Math.max(usageNorm.dc / limits.daily, usageNorm.mc / (limits.monthly + aiExtra)) : 0
  const refreshUsage = () => { if (tenantId) getAiUsage(tenantId).then(setUsage).catch(() => {}) }
  useEffect(refreshUsage, [tenantId, busy]) // eslint-disable-line react-hooks/exhaustive-deps
  // credit packs (priced — platform confirms + credits tenant.aiExtra after payment)
  const PACKS = [
    { qty: 100, price: 49 },
    { qty: 300, price: 129 },
    { qty: 1000, price: 349 },
  ]
  // Direct card checkout (Moyasar): pack price is derived SERVER-side, and on
  // webhook settlement the credits land on the venue automatically + a paid
  // invoice appears in the platform console. Fallback: a manual request issue.
  const buyCredits = async (pack) => {
    setBuyBusy(true)
    try {
      const { startPayment } = await import('../../lib/payments.js')
      await startPayment('aiCredits', tenantId, String(pack.qty))
      // navigation to /pay/:intentId happens inside startPayment
    } catch (e) {
      toast.error(e?.message === 'no-checkout-url' || String(e?.message || '').includes('internal')
        ? (ar ? 'الدفع المباشر غير مفعّل بعد (انشر الدوال) — أرسل طلباً للإدارة بدلاً عنه' : 'Direct checkout unavailable — send a request instead')
        : String(e?.message || e))
      setBuyBusy(false)
    }
  }
  const requestCredits = async (pack) => {
    setBuyBusy(true)
    try {
      await createIssue(tenantId, {
        tenantName: tenant?.name || '',
        title: `[شراء رصيد ذكاء] ${pack.qty} طلب — ${pack.price} ر.س`,
        body: `طلب شراء رصيد مساعد ذكي.\nالباقة: ${pack.qty} طلب إضافي\nالسعر: ${pack.price} ر.س\nالاستهلاك الحالي: اليوم ${usageNorm?.dc ?? 0}/${limits.daily} · الشهر ${usageNorm?.mc ?? 0}/${limits.monthly + aiExtra}\nبعد اعتماد السداد: أضف الكمية إلى tenant.aiExtra من كونسول المنصة.`,
        priority: 'high',
        createdBy: profile?.id || null,
        createdByName: actor || '',
      })
      toast.success(ar ? 'أُرسل طلب الشراء للإدارة — يُفعَّل الرصيد فور اعتماد السداد' : 'Purchase request sent')
      setBuyOpen(false)
    } catch (_) { toast.error(ar ? 'تعذّر إرسال الطلب' : 'Request failed') } finally { setBuyBusy(false) }
  }
  const library = useMemo(() => {
    if (!libOpen || !tenantId) return []
    return listChats(tenantId).flatMap((c) => {
      const ch = getChat(tenantId, c.id)
      return (ch?.messages || []).flatMap((m) => (m.files || []).map((f) => ({ ...f, chatTitle: c.title, chatId: c.id })))
    })
  }, [libOpen, tenantId, chats]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickFiles = async (fileList) => {
    const arr = Array.from(fileList || [])
    if (!arr.length) return
    setLoadingFiles(true)
    try {
      const out = []
      for (const f of arr) { try { out.push(await fileToAttachment(f)) } catch (_) { /* skip bad file */ } }
      setAtts((prev) => [...prev, ...out].slice(0, 8))
    } finally { setLoadingFiles(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const onKey = (e) => {
    if (slash && cmdMatches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => (h + 1) % cmdMatches.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => (h - 1 + cmdMatches.length) % cmdMatches.length); return }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(p(cmdMatches[hl])); return }
      if (e.key === 'Escape') { setInput(''); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }
  const grow = (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(180, e.target.scrollHeight) + 'px'; setInput(e.target.value) }

  const modelBadge = mode === 'deep' ? (ar ? 'عميق' : 'Deep') : (ar ? 'سريع' : 'Fast')

  return (
    <div className="ai-shell" dir={ar ? 'rtl' : 'ltr'}>
      {sideOpen && <div className="ai-backdrop" onClick={() => setSideOpen(false)} />}
      {/* history sidebar */}
      <aside className={`ai-sidebar ${sideOpen ? '' : 'hidden'}`}>
        <div className="ai-sidebar-head">
          <button className="ai-new-btn" onClick={newChat}><Icon name="add" size={16} /> {ar ? 'محادثة جديدة' : 'New chat'}</button>
        </div>
        <div className="ai-chat-list">
          <div className="lbl">{ar ? 'السجل' : 'History'}</div>
          {chats.length === 0 && <div className="xs faint" style={{ padding: '4px 8px' }}>{ar ? 'لا محادثات بعد' : 'No conversations yet'}</div>}
          {chats.map((c) => (
            <div key={c.id} className={`ai-chat-row ${c.id === chatId ? 'active' : ''}`} onClick={() => loadChat(c.id)}>
              <Icon name="sparkles" size={14} />
              <span className="t">{c.title}</span>
              <button className="x" title={ar ? 'حذف' : 'Delete'} onClick={(e) => removeChat(e, c.id)}><Icon name="delete" size={13} /></button>
            </div>
          ))}
        </div>
      </aside>

      {/* main chat */}
      <main className="ai-main">
        <header className="ai-topbar">
          <button className="ai-icon-btn" onClick={() => setSideOpen((s) => !s)} title={ar ? 'السجل' : 'History'}><Icon name="menu" size={18} /></button>
          <div className="title"><Icon name="sparkles" size={18} /> {ar ? 'المساعد الذكي' : 'AI Assistant'} <span className="ai-badge-risk" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>{modelBadge}</span></div>
          <div className="spacer" />
          {/* usage meter + buy credits */}
          {usageNorm && (
            <button className="ai-icon-btn" onClick={() => setBuyOpen(true)} title={ar ? 'الاستهلاك وشراء رصيد' : 'Usage & credits'}
              style={{ width: 'auto', paddingInline: 10, gap: 6, display: 'inline-flex', alignItems: 'center', color: usagePct >= 0.8 ? 'var(--danger)' : undefined }}>
              <Icon name="zap" size={14} />
              <span className="xs num" style={{ fontWeight: 800 }}>{usageNorm.dc}/{limits.daily}</span>
              <span style={{ width: 34, height: 4, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden', display: 'inline-block' }}>
                <span style={{ display: 'block', height: '100%', width: `${Math.min(100, usagePct * 100)}%`, background: usagePct >= 0.8 ? 'var(--danger)' : 'var(--brand)' }} />
              </span>
            </button>
          )}
          <button className="ai-icon-btn" onClick={() => setLibOpen(true)} title={ar ? 'مكتبة المرفقات — كل الصور والملفات من كل المحادثات' : 'Attachment library'}><Icon name="folder" size={17} /></button>
          <button className={`ai-autorun ${autoRun ? 'on' : ''}`} onClick={() => setAutoRun((v) => !v)} title={ar ? 'تنفيذ الإجراءات تلقائياً دون تأكيد (عدا الحسّاسة)' : 'Auto-run write actions without asking (except destructive)'}>
            <Icon name={autoRun ? 'play' : 'check'} size={13} /> <span>{ar ? 'تنفيذ تلقائي' : 'Auto-run'}</span>
          </button>
          <div className="ai-mode" title={ar ? 'وضع الاستجابة' : 'Response mode'}>
            <button className={mode === 'fast' ? 'on' : ''} onClick={() => setMode('fast')}><Icon name="trending" size={13} /> {ar ? 'سريع' : 'Fast'}</button>
            <button className={mode === 'deep' ? 'on' : ''} onClick={() => setMode('deep')}><Icon name="sparkles" size={13} /> {ar ? 'عميق' : 'Deep'}</button>
          </div>
        </header>

        <div className="ai-scroll" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="ai-empty">
              <div className="orb"><Icon name="sparkles" size={30} /></div>
              <div>
                <h3>{ar ? `مرحباً، أنا مساعد ${tenant?.name || ''}` : `Hi, I'm the ${tenant?.name || ''} assistant`}</h3>
                <p className="muted small" style={{ marginTop: 6 }}>{ar ? 'اسألني عن مبيعاتك ومخزونك، أو اطلب تنفيذ أي تعديل. اكتب / للأوامر.' : 'Ask about sales & inventory, or ask me to make a change. Type / for commands.'}</p>
              </div>
              {!aiConfigured() && <div className="card card-pad xs faint">{ar ? 'أضِف VITE_GEMINI_API_KEY في .env.local لتفعيل المساعد.' : 'Add VITE_GEMINI_API_KEY to .env.local to enable the assistant.'}</div>}
              <div className="ai-chips">
                {COMMANDS.slice(0, 6).map((c) => (
                  <button key={c.k} className="ai-chip" onClick={() => send(p(c))}><span className="ic"><Icon name={c.icon} size={16} /></span>{ar ? c.ar : c.en}</button>
                ))}
              </div>
            </div>
          ) : messages.map((m, i) => {
            if (m.type === 'thought') return (
              <div key={i} style={{ maxWidth: 820, margin: '0 auto 10px' }}><Thought text={m.text} ar={ar} /></div>
            )
            if (m.type === 'action') return (
              <div key={i} className={`ai-action ${m.skipped ? 'skipped' : 'run'} ${!m.skipped && m.result === undefined ? 'ai-action-live' : ''}`}>
                <span className="ic">{!m.skipped && m.result === undefined ? <span className="spinner" style={{ width: 15, height: 15 }} /> : <Icon name="settings" size={15} />}</span>
                <div style={{ minWidth: 0 }}>
                  <div>
                    <span className="bold">{m.name}</span>
                    {m.skipped && <span className="faint"> — {ar ? 'مُلغى' : 'skipped'}</span>}
                    {!m.skipped && m.result === undefined && <RunningTimer since={m.startedAt} ar={ar} />}
                    {m.tookMs != null && <span className="xs faint num"> · {(m.tookMs / 1000).toFixed(1)}{ar ? ' ث' : 's'}</span>}
                  </div>
                  <code>{JSON.stringify(m.args)}</code>
                  {m.result && (
                    <div className="xs" style={{ marginTop: 3, color: m.result.error ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>
                      {m.result.error ? <span className="row" style={{ gap: 4, alignItems: 'center', display: 'inline-flex' }}><Icon name="close" size={12} /> {m.result.error}</span> : (m.result.ok !== false ? <span className="row" style={{ gap: 4, alignItems: 'center', display: 'inline-flex' }}><Icon name="check" size={12} /> {ar ? 'تم بنجاح' : 'done'}{m.result.id ? ` · ${m.result.id}` : ''}</span> : <span className="row" style={{ gap: 4, alignItems: 'center', display: 'inline-flex' }}><Icon name="warning" size={12} /> {JSON.stringify(m.result).slice(0, 90)}</span>)}
                    </div>
                  )}
                </div>
              </div>
            )
            const me = m.role === 'user'
            return (
              <div key={i} className={`ai-turn ${me ? 'user' : 'ai'}`}>
                <div className={`ai-avatar ${me ? 'me' : 'ai'}`}>{me ? <Icon name="user" size={15} /> : <Icon name="sparkles" size={15} />}</div>
                <div className="ai-bubble">
                  {me ? (
                    <>
                      {m.files?.length > 0 && <div className="ai-files-inline">{m.files.map((f, k) => (f.preview ? <img key={k} src={f.preview} alt={f.name} className="ai-file-thumb" /> : <span key={k} className="ai-file-chip"><Icon name={f.kind === 'pdf' ? 'reports' : 'download'} size={12} /> {f.name}</span>))}</div>}
                      {m.text && <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>}
                    </>
                  ) : (m.stream ? <TypeText text={m.text} onTick={scrollDown} /> : <Markdown text={m.text} />)}
                  {/* message tools: copy on both sides; edit-resend on user turns; regenerate on the last reply */}
                  {m.text && !busy && (
                    <div className="ai-msg-tools">
                      <button onClick={() => copyMsg(m)} title={ar ? 'نسخ النص' : 'Copy'}><Icon name="copy" size={13} /></button>
                      {me && <button onClick={() => editUserMsg(i)} title={ar ? 'تعديل وإعادة الإرسال' : 'Edit & resend'}><Icon name="edit" size={13} /></button>}
                      {!me && i > lastUserIdx && lastUserIdx >= 0 && (
                        <button onClick={regenerate} title={ar ? 'إعادة توليد الرد' : 'Regenerate'}><Icon name="repeat" size={13} /></button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {busy && !pending && (
            <div className="ai-turn ai"><div className="ai-avatar ai"><Icon name="sparkles" size={15} /></div>
              <div className="ai-bubble"><div className="ai-think"><span /><span /><span />{mode === 'deep' && <span className="xs faint" style={{ marginInlineStart: 6 }}>{ar ? 'يفكّر بعمق…' : 'thinking deeply…'}</span>}</div></div>
            </div>
          )}
        </div>

        {/* approval strip for write actions */}
        {pending && (
          <div className="ai-action run" style={{ margin: '10px clamp(12px,6%,60px)', borderColor: pending.risk === 'danger' ? 'var(--danger)' : 'var(--brand)' }}>
            <span className="ic"><Icon name="settings" size={15} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><span className="bold">{ar ? 'تنفيذ إجراء' : 'Run action'}: {pending.name}</span><span className={`ai-badge-risk ${pending.risk}`}>{pending.risk === 'danger' ? (ar ? 'حسّاس' : 'danger') : (ar ? 'يحتاج تأكيد' : 'confirm')}</span></div>
              <code>{JSON.stringify(pending.args)}</code>
              <div className="ai-approve">
                <button className="yes" onClick={() => decide(true)}><Icon name="check" size={13} /> {ar ? 'تنفيذ' : 'Approve'}</button>
                <button className="no" onClick={() => decide(false)}>{ar ? 'رفض' : 'Reject'}</button>
              </div>
            </div>
          </div>
        )}

        {/* composer */}
        <div className="ai-composer">
          {slash && cmdMatches.length > 0 && (
            <div className="ai-palette">
              {cmdMatches.map((c, idx) => (
                <div key={c.k} className={`cmd ${idx === hl ? 'hl' : ''}`} onMouseEnter={() => setHl(idx)} onClick={() => send(p(c))}>
                  <span className="ic"><Icon name={c.icon} size={15} /></span>
                  <span className="k">/{c.k}</span>
                  <span className="d">{ar ? c.ar : c.en}</span>
                </div>
              ))}
            </div>
          )}
          {(atts.length > 0 || loadingFiles) && (
            <div className="ai-attach-row">
              {atts.map((a, k) => (
                <div key={k} className="ai-attach">
                  {a.kind === 'image' && a.preview ? <img src={a.preview} alt={a.name} /> : <span className="fic"><Icon name={a.kind === 'pdf' ? 'reports' : 'download'} size={14} /></span>}
                  <span className="fn">{a.name}</span>
                  <button onClick={() => setAtts((p) => p.filter((_, j) => j !== k))}><Icon name="close" size={12} /></button>
                </div>
              ))}
              {loadingFiles && <div className="ai-attach"><span className="fic"><Icon name="clock" size={14} /></span><span className="fn">{ar ? 'جارٍ القراءة…' : 'reading…'}</span></div>}
            </div>
          )}
          <div className="ai-input-wrap">
            <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => pickFiles(e.target.files)} />
            <button className="ai-attach-btn" onClick={() => fileRef.current?.click()} title={ar ? 'إرفاق صور / فواتير / إكسل' : 'Attach images / invoices / Excel'}><Icon name="image" size={18} /></button>
            <textarea
              ref={taRef} className="ai-textarea" rows={1}
              placeholder={ar ? 'اكتب رسالة، أرفق ملفاً، أو / للأوامر…' : 'Message, attach a file, or / for commands…'}
              value={input} onChange={grow} onKeyDown={onKey} disabled={busy && !!pending}
            />
            <button className="ai-send" disabled={busy || (!input.trim() && !atts.length)} onClick={() => send()} title={ar ? 'إرسال' : 'Send'}>
              <Icon name={ar ? 'back' : 'next'} size={18} />
            </button>
          </div>
          <div className="ai-hint">{ar ? 'يمكنك إرفاق صور منتجات أو فواتير أو ملف إكسل — قد يخطئ المساعد، راجع الإجراءات قبل الموافقة.' : 'Attach product photos, invoices or an Excel file — the assistant can make mistakes; review actions before approving.'}</div>
        </div>
      </main>

      {/* attachment library: every image/file from every conversation, in one place */}
      {/* usage + buy credits */}
      <Sheet open={buyOpen} onClose={() => setBuyOpen(false)} title={ar ? 'استهلاك المساعد وشراء رصيد' : 'AI usage & credits'}>
        <div className="stack" style={{ gap: 12 }}>
          <div className="card card-pad stack" style={{ gap: 8 }}>
            <div className="row-between small"><span>{ar ? 'اليوم' : 'Today'}</span><strong className="num">{usageNorm?.dc ?? 0} / {limits.daily}</strong></div>
            <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(100, ((usageNorm?.dc ?? 0) / limits.daily) * 100)}%`, background: 'var(--brand)' }} /></div>
            <div className="row-between small"><span>{ar ? 'هذا الشهر' : 'This month'}</span><strong className="num">{usageNorm?.mc ?? 0} / {limits.monthly + aiExtra}</strong></div>
            <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(100, ((usageNorm?.mc ?? 0) / (limits.monthly + aiExtra)) * 100)}%`, background: 'var(--brand)' }} /></div>
            {aiExtra > 0 && <span className="xs faint">{ar ? `يشمل ${aiExtra} طلباً إضافياً مشترى` : `Includes ${aiExtra} purchased`}</span>}
            <span className="xs faint">{ar ? 'الحد اليومي يتجدد منتصف الليل، والشهري أول كل شهر. الحدود تضبطها إدارة المنصة لكل باقة.' : 'Daily resets at midnight; monthly on the 1st.'}</span>
          </div>
          <strong className="small">{ar ? 'شراء رصيد إضافي' : 'Buy extra requests'}</strong>
          {PACKS.map((p) => (
            <div key={p.qty} className="card card-pad row-between wrap" style={{ gap: 8 }}>
              <span className="row" style={{ gap: 8 }}><Icon name="zap" size={16} style={{ color: 'var(--brand)' }} /><strong className="num">{p.qty}</strong> <span className="small faint">{ar ? 'طلب إضافي' : 'requests'}</span></span>
              <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                <span className="badge badge-gold num">{p.price} {ar ? 'ر.س' : 'SAR'}</span>
                <button className="btn btn-sm btn-primary" disabled={buyBusy} onClick={() => buyCredits(p)}>
                  <Icon name="card" size={13} /> {ar ? 'ادفع الآن' : 'Pay now'}
                </button>
                <button className="btn btn-sm btn-ghost" disabled={buyBusy} onClick={() => requestCredits(p)} title={ar ? 'طلب يدوي تعتمده الإدارة (تحويل بنكي…)' : 'Manual request'}>
                  {ar ? 'طلب يدوي' : 'Request'}
                </button>
              </span>
            </div>
          ))}
          <p className="xs faint" style={{ margin: 0 }}>
            {ar ? '«ادفع الآن»: بطاقة/مدى/Apple Pay — يُضاف الرصيد لحسابك تلقائياً لحظة نجاح الدفع وتظهر الفاتورة للإدارة فوراً. «طلب يدوي»: للتحويل البنكي وتعتمده الإدارة.' : 'Pay now: card/mada/Apple Pay — credits land automatically on settlement. Request: bank transfer confirmed by the platform.'}
          </p>
        </div>
      </Sheet>

      <Sheet open={libOpen} onClose={() => setLibOpen(false)} title={ar ? 'مكتبة المرفقات' : 'Attachment library'}>
        {library.length === 0 ? (
          <p className="faint small" style={{ textAlign: 'center', padding: 'var(--sp-5)' }}>
            {ar ? 'لا مرفقات بعد — كل صورة أو ملف ترفعه في أي محادثة يُجمع هنا تلقائياً.' : 'No attachments yet — every file you upload in any chat collects here.'}
          </p>
        ) : (
          <div className="ai-lib-grid">
            {library.map((f, i) => (
              <button key={i} type="button" className="ai-lib-item" title={f.name}
                onClick={() => { if (f.chatId) { loadChat(f.chatId); setLibOpen(false) } }}>
                {f.preview
                  ? <img src={f.preview} alt={f.name} />
                  : <span className="ai-lib-file"><Icon name={f.kind === 'pdf' ? 'reports' : 'download'} size={20} /></span>}
                <span className="xs t">{f.name}</span>
                <span className="xs faint t">{f.chatTitle}</span>
              </button>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  )
}
