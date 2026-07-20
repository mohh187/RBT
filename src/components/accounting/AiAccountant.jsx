import { useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { aiQuick, aiConfigured } from '../../lib/aiBridge.js'
import { buildAiPrompt } from '../../lib/accounting.js'

const QUICK_PROMPTS_AR = [
  'كم ربحي هذا الشهر؟',
  'لماذا انخفض الهامش؟',
  'ما أكبر ثلاث مشاكل في حساباتي؟',
  'جهز لي ملخصاً ضريبياً للفترة',
  'اقترح استراتيجية لرفع الهامش خمسة بالمئة',
  'أين تذهب أكبر مصروفاتي؟',
]
const QUICK_PROMPTS_EN = [
  'What is my profit this period?',
  'Why did my margin drop?',
  'What are my three biggest accounting problems?',
  'Summarise my VAT position',
  'How do I raise my margin by five percent?',
  'Where is most of my spend going?',
]

// The AI accountant NEVER queries the database and never sees raw documents.
// It receives ONE compact JSON snapshot computed locally from the real ledger,
// wrapped in a hard instruction to answer only from those figures. Every answer
// ships with the exact snapshot it was given, so the manager can verify any
// number the model quotes. That is the whole anti-hallucination design.
export default function AiAccountant({ snapshot, ar = true, disabled = false, disabledReason = '' }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [openSnap, setOpenSnap] = useState(null)
  const boxRef = useRef(null)

  const configured = aiConfigured()
  const blocked = disabled || !configured

  const ask = async (question) => {
    const q = (question ?? input).trim()
    if (!q || busy || blocked) return
    setInput('')
    // The snapshot is frozen at ask-time and stored with the message, so the
    // "numbers used" block always matches the answer even if the period changes.
    const snap = snapshot
    setMessages((m) => [...m, { role: 'user', text: q }])
    setBusy(true)
    try {
      const reply = await aiQuick(buildAiPrompt(q, snap), { model: 'gemini-2.5-flash' })
      setMessages((m) => [...m, {
        role: 'ai',
        text: reply || (ar ? 'لم يصل رد من النموذج. أعد المحاولة.' : 'No reply from the model.'),
        snapshot: snap,
      }])
    } catch (e) {
      setMessages((m) => [...m, {
        role: 'error',
        text: (ar ? 'تعذّر الوصول إلى المساعد: ' : 'Assistant unavailable: ') + (e?.message || e),
      }])
    } finally {
      setBusy(false)
      requestAnimationFrame(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight })
    }
  }

  const prompts = ar ? QUICK_PROMPTS_AR : QUICK_PROMPTS_EN
  const coverage = snapshot?.dataCoverage || {}
  const thin = !coverage.journalEntries

  return (
    <div className="acc-stack">
      <div className="acc-card">
        <span className="acc-card-title"><Icon name="sparkles" size={17} /> {ar ? 'المحاسب الذكي' : 'AI accountant'}</span>
        <p className="acc-hint">
          {ar
            ? 'يجيب من أرقام هذه الفترة فقط — تُرسل إليه لقطة مالية حقيقية مع تعليمات صارمة بعدم اختراع أي رقم. مع كل إجابة يظهر «الأرقام المستخدمة» لتراجعها بنفسك.'
            : 'Answers only from this period\'s real figures, with the exact snapshot shown under every reply.'}
        </p>

        {blocked && (
          <div className="acc-warn">
            <Icon name="warning" size={15} />
            <span>{disabledReason || (ar ? 'المساعد الذكي غير مُهيَّأ في هذه البيئة.' : 'The assistant is not configured.')}</span>
          </div>
        )}
        {!blocked && thin && (
          <div className="acc-warn">
            <Icon name="warning" size={15} />
            <span>{ar ? 'لا توجد قيود محاسبية في هذه الفترة، لذلك لن يستطيع المحاسب الذكي الإجابة برقم. غيّر الفترة أو سجّل بياناتك أولاً.' : 'No journal entries in this period.'}</span>
          </div>
        )}

        <div className="acc-chat" ref={boxRef}>
          {!messages.length ? (
            <p className="acc-empty">{ar ? 'اسأل عن أي شيء في حساباتك.' : 'Ask anything about your books.'}</p>
          ) : messages.map((m, i) => (
            <div key={i} className={`acc-msg is-${m.role}`}>
              <div className="acc-msg-body">{m.text}</div>
              {m.snapshot && (
                <>
                  <button type="button" className="acc-snap-toggle" onClick={() => setOpenSnap(openSnap === i ? null : i)} aria-expanded={openSnap === i}>
                    <Icon name={openSnap === i ? 'arrowUpDown' : 'next'} size={12} />
                    {ar ? 'الأرقام المستخدمة' : 'Numbers used'}
                  </button>
                  {openSnap === i && (
                    <pre className="acc-snap acc-scroll-y" dir="ltr">{JSON.stringify(m.snapshot, null, 2)}</pre>
                  )}
                </>
              )}
            </div>
          ))}
          {busy && <div className="acc-msg is-ai"><div className="acc-msg-body acc-typing">{ar ? 'يحسب من دفاترك' : 'Reading your books'}<span>.</span><span>.</span><span>.</span></div></div>}
        </div>

        <div className="acc-scroll-x">
          <div className="acc-quick">
            {prompts.map((p) => (
              <button key={p} type="button" className="chip" disabled={busy || blocked} onClick={() => ask(p)}>{p}</button>
            ))}
          </div>
        </div>

        <form className="acc-ask" onSubmit={(e) => { e.preventDefault(); ask() }}>
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={ar ? 'اكتب سؤالك المحاسبي' : 'Ask an accounting question'}
            disabled={busy || blocked}
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy || blocked || !input.trim()}>
            <Icon name="next" size={15} /> {ar ? 'اسأل' : 'Ask'}
          </button>
        </form>
      </div>
    </div>
  )
}
