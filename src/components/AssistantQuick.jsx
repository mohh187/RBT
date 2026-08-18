import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'
import { runAssistant, aiConfigured } from '../lib/aiBridge.js'

// Starter chips: the three questions a manager actually asks between tasks.
// Clicking one sends it immediately — the quick sheet exists to remove typing.
const CHIPS = [
  'كم مبيعات اليوم؟',
  'ما الأصناف الأكثر طلباً هذا الأسبوع؟',
  'اقترح عرضاً ترويجياً لهذا الأسبوع',
]

// «المساعد السريع» — a floating one-question chat over any admin screen.
// It runs the SAME engine as /admin/assistant (runAssistant: live snapshot,
// venue vocabulary, the full read-tool registry), not the stripped aiQuick
// one-shot — so «كم مبيعات اليوم؟» is answered from the real sales_report
// tool, with real numbers. The difference from the full page is deliberate
// scope, not a weaker model:
//   · READ-ONLY: `allow` refuses every write, so a stray «امسح المنيو» typed
//     over the cashier can never execute here — the model is told the action
//     was declined and answers in prose. Writes belong to the full page with
//     its per-action approval UI.
//   · SESSION-ONLY history: nothing persists to the chat store; closing the
//     sheet forgets the thread. The full page owns durable conversations.
export default function AssistantQuick({ open, onClose }) {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const navigate = useNavigate()
  const { tenantId, tenant, profile } = useAuth()
  const actor = profile?.displayName || profile?.email || ''
  const [messages, setMessages] = useState([]) // [{role:'user'|'assistant'|'error', text}]
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [acting, setActing] = useState(false) // a read tool is running right now
  const [actingText, setActingText] = useState('') // status line override (retry notice)
  const boxRef = useRef(null)
  const configured = aiConfigured()

  const scrollDown = () => requestAnimationFrame(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight })

  const ask = async (q) => {
    const text = String(q ?? input).trim()
    if (!text || busy || !configured) return
    setInput('')
    // History for the model: only the real conversational turns (errors and
    // status lines would poison the alternating user/model transcript).
    const history = [...messages.filter((m) => m.role === 'user' || m.role === 'assistant'), { role: 'user', text }]
    const collected = [...messages, { role: 'user', text }]
    setMessages(collected)
    setBusy(true)
    scrollDown()
    try {
      await runAssistant({
        tid: tenantId, tenant, actor, history, mode: 'fast',
        // Mirror of the full page's event loop, minimally: each text turn is a
        // bubble; tool calls collapse into one transient «ينفّذ إجراء…» line
        // (the quick sheet has no room for the action cards); thoughts dropped.
        onEvent: (e) => {
          if (e.type === 'text') { collected.push({ role: 'assistant', text: e.text }); setMessages([...collected]); setActing(false); scrollDown() }
          else if (e.type === 'action') { setActing(true); setActingText(''); scrollDown() }
          else if (e.type === 'action-result') setActing(false)
          // 'thought' carries the rate-limit retry notice («النموذج مزدحم…») —
          // swallowing it left the sheet stuck on «يفكّر…» with no explanation
          else if (e.type === 'thought' && e.text) { setActing(true); setActingText(e.text); scrollDown() }
        },
        // READ MODE: decline every non-safe action. Reads (risk 'safe') never
        // reach `allow`, so reports/analytics flow freely; any write the model
        // attempts is skipped and it explains itself in text.
        allow: async () => false,
      })
    } catch (e) {
      collected.push({ role: 'error', text: (ar ? 'تعذّر الوصول إلى المساعد: ' : 'Assistant unavailable: ') + String(e?.message || e) })
      setMessages([...collected])
    } finally {
      setBusy(false)
      setActing(false)
      setActingText('')
      scrollDown()
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      tall
      title={ar ? 'المساعد السريع' : 'Quick assistant'}
      footer={(
        <button type="button" className="btn btn-outline" style={{ width: '100%' }} onClick={() => { onClose?.(); navigate('/admin/assistant') }}>
          <Icon name="sparkles" size={16} /> {ar ? 'المساعد الكامل' : 'Full assistant'}
        </button>
      )}
    >
      {/* height:100% fills the tall sheet's fixed-height body, so the chat
          column scrolls internally and the ask bar stays pinned below it. */}
      <div className="stack" style={{ gap: 'var(--sp-3)', height: '100%', minHeight: 0 }}>
        {!configured && (
          <p className="small muted">{ar ? 'المساعد الذكي غير مُهيَّأ في هذه البيئة.' : 'AI is not configured in this environment.'}</p>
        )}

        <div className="aiq-chat" ref={boxRef}>
          {!messages.length ? (
            <div className="stack" style={{ gap: 'var(--sp-2)' }}>
              <p className="small muted">
                {ar
                  ? 'سؤال سريع بأرقام منشأتك الحقيقية — دون مغادرة الشاشة. للأوامر التنفيذية (تعديل المنيو، الحملات…) استخدم المساعد الكامل.'
                  : 'A quick question over your venue\'s real numbers, without leaving the screen. For write commands use the full assistant.'}
              </p>
              <div className="aiq-chips">
                {CHIPS.map((c) => (
                  <button key={c} type="button" className="chip" disabled={busy || !configured} onClick={() => ask(c)}>{c}</button>
                ))}
              </div>
            </div>
          ) : messages.map((m, i) => (
            <div key={i} className={`aiq-msg is-${m.role}`}>{m.text}</div>
          ))}
          {acting && <div className="aiq-msg is-status">{actingText || (ar ? 'ينفّذ إجراء…' : 'Running an action…')}</div>}
          {busy && !acting && <div className="aiq-msg is-status">{ar ? 'يفكّر…' : 'Thinking…'}</div>}
        </div>

        <form className="aiq-ask" onSubmit={(e) => { e.preventDefault(); ask() }}>
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={ar ? 'اسأل عن منشأتك…' : 'Ask about your venue…'}
            disabled={busy || !configured}
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !configured || !input.trim()}>
            <Icon name="next" size={15} /> {ar ? 'اسأل' : 'Ask'}
          </button>
        </form>
      </div>
    </Sheet>
  )
}
