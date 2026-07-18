// Platform AI assistant (/platform/assistant).
// Two panels:
//   1) EXECUTIVE chat — a real agent with cross-venue authority: it reads live
//      platform data AND executes actions (suspend/activate venues, plans,
//      trial extensions, broadcasts, venue messages, domains, coupons, tickets)
//      through the platformAiActions.js tool registry via askExecutive().
//   2) Error insights — recurring error signatures (grouping) from platformErrors.
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import Markdown from '../../components/Markdown.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { useAuth } from '../../lib/auth.jsx'
import { watchAllTenants, watchRecentStats, watchErrors } from '../../lib/platform.js'
import { PLANS } from '../../lib/plans.js'
import { askExecutive, groupErrors } from '../../lib/platformAI.js'
import { fmtWhen } from './shared.jsx'

// Build a short, token-cheap Arabic context summary out of live data.
function buildContext(tenants, stats) {
  const total = tenants.length
  const active = tenants.filter((t) => t.active !== false).length
  const suspended = total - active
  // Plan breakdown in canonical PLANS order.
  const planCounts = {}
  for (const t of tenants) {
    const id = t.plan || 'enterprise'
    planCounts[id] = (planCounts[id] || 0) + 1
  }
  const planLine = PLANS
    .map((p) => `${p.ar}: ${planCounts[p.id] || 0}`)
    .join('، ')
  // Status breakdown.
  const trial = tenants.filter((t) => t.planStatus === 'trial').length
  const expired = tenants.filter((t) => t.planStatus === 'expired').length

  // Recent stats: sum the latest window of daily stat docs.
  const days = stats.length
  const revenue = stats.reduce((s, d) => s + (d.revenue || 0), 0)
  const orders = stats.reduce((s, d) => s + (d.orders || 0), 0)
  const recent = stats
    .slice(0, 7)
    .map((d) => `${d.date || d.id}: إيراد ${d.revenue || 0}، طلبات ${d.orders || 0}`)
    .join(' | ')

  return [
    `إجمالي المنشآت: ${total} (نشطة: ${active}، موقوفة: ${suspended}).`,
    `حالة الاشتراك: تجريبي ${trial}، منتهٍ ${expired}.`,
    `توزيع الخطط — ${planLine}.`,
    `إجمالي آخر ${days} يوم: الإيراد ${revenue.toLocaleString('en-US')}، الطلبات ${orders.toLocaleString('en-US')}.`,
    days ? `تفصيل آخر الأيام: ${recent}.` : 'لا توجد إحصاءات يومية بعد.',
  ].join('\n')
}

// Executive suggested prompts — read AND execute.
const SUGGESTED = [
  'ما المنشآت المعرضة للخطر؟ ومدّد أسبوعاً لمن يستحق منها',
  'أعطني تقرير أداء المنصة لآخر 7 أيام مع أفضل المنشآت إيراداً',
  'أوقف منشأة … مع ذكر السبب',
  'مدّد تجربة منشأة … أسبوعاً',
  'أرسل تعميماً لكل المنشآت: …',
  'ما الأخطاء الأكثر تكراراً الآن وما خطورتها؟',
]

// One executed-tool row in the chat: a small badge + its outcome.
function ActionBadge({ m }) {
  const failed = m.result && m.result.error
  const done = m.result && !m.result.error
  return (
    <div className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', paddingInlineStart: 4 }}>
      <span className={`badge ${failed ? 'badge-danger' : 'badge-info'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none' }}>
        <Icon name="settings" size={11} /> نفّذ: {m.name}
      </span>
      {m.result === undefined ? (
        <span className="xs faint" style={{ marginTop: 2 }}>جارٍ التنفيذ…</span>
      ) : failed ? (
        <span className="xs" style={{ color: 'var(--danger)', marginTop: 2, wordBreak: 'break-word' }}>{String(m.result.error).slice(0, 160)}</span>
      ) : done && m.result.message ? (
        <span className="xs" style={{ color: 'var(--success)', marginTop: 2, wordBreak: 'break-word' }}>
          <Icon name="check" size={11} style={{ verticalAlign: 'middle' }} /> {m.result.message}
        </span>
      ) : (
        <span className="xs faint" style={{ marginTop: 2 }}>
          <Icon name="check" size={11} style={{ verticalAlign: 'middle' }} /> تمت القراءة
        </span>
      )}
    </div>
  )
}

export default function PlatformAssistant() {
  const toast = useToast()
  const { user, profile } = useAuth()
  const [tenants, setTenants] = useState(null)
  const [stats, setStats] = useState(null)
  const [errors, setErrors] = useState(null)

  // Chat state: role messages ({role:'user'|'assistant', text}) interleaved with
  // executed-tool rows ({type:'action', name, args, result}).
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef(null)
  const scrollDown = () => setTimeout(() => { const s = scrollRef.current; if (s) s.scrollTop = s.scrollHeight }, 30)

  useEffect(() => {
    const u1 = watchAllTenants((rows) => setTenants(rows || []))
    const u2 = watchRecentStats((rows) => setStats(rows || []), 30)
    const u3 = watchErrors((rows) => setErrors(rows || []), 200)
    return () => { u1 && u1(); u2 && u2(); u3 && u3() }
  }, [])

  const context = useMemo(
    () => buildContext(tenants || [], stats || []),
    [tenants, stats]
  )
  const groups = useMemo(() => groupErrors(errors || []), [errors])

  async function send(raw) {
    const text = String(raw ?? input).trim()
    if (!text) { toast.error('اكتب طلباً أولاً.'); return }
    if (busy) return
    setInput('')

    const userMsg = { role: 'user', text }
    const collected = [...messages, userMsg]
    setMessages(collected)
    setBusy(true)
    scrollDown()
    const push = (m) => { collected.push(m); setMessages([...collected]); scrollDown() }

    try {
      await askExecutive({
        history: collected.filter((m) => m.role),
        prompt: text,
        context,
        user,
        actor: profile?.displayName || user?.email || '',
        onEvent: (e) => {
          if (e.type === 'text') push({ role: 'assistant', text: e.text })
          else if (e.type === 'action') push({ type: 'action', name: e.name, args: e.args })
          else if (e.type === 'action-result') {
            for (let j = collected.length - 1; j >= 0; j--) {
              if (collected[j].type === 'action' && collected[j].name === e.name && collected[j].result === undefined) {
                collected[j] = { ...collected[j], result: e.result }
                break
              }
            }
            setMessages([...collected])
            scrollDown()
          }
          // 'thought' events (retry notices) are intentionally not rendered.
        },
      })
    } catch (e) {
      push({ role: 'assistant', text: `تعذّر التنفيذ: ${String(e?.message || e)}` })
      toast.error('تعذّر تنفيذ الطلب.')
    } finally {
      setBusy(false)
      scrollDown()
    }
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const loading = tenants === null || stats === null

  return (
    <div className="page">
      <div className="row-between" style={{ marginBottom: 'var(--sp-4)' }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="sparkles" size={20} /> المساعد التنفيذي للمنصّة
        </h1>
        {messages.length > 0 && (
          <button className="btn btn-outline" disabled={busy} onClick={() => setMessages([])} style={{ padding: '6px 12px' }}>
            <Icon name="add" size={14} /> محادثة جديدة
          </button>
        )}
      </div>

      {/* Capability note */}
      <div className="card card-pad" style={{ marginBottom: 'var(--sp-4)', borderInlineStart: '3px solid var(--brand)' }}>
        <div className="small" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--brand)', flex: 'none', marginTop: 2 }}><Icon name="warning" size={15} /></span>
          <span className="faint">
            هذا مساعد <span className="bold">تنفيذي</span> بصلاحية المنصّة كاملة: يقرأ بيانات كل المنشآت
            <span className="bold"> وينفّذ</span> إجراءات حقيقية (إيقاف/تفعيل منشأة، تغيير خطة، تمديد تجربة،
            تعاميم، رسائل مباشرة، نطاقات، كوبونات، تذاكر دعم). يطلب تأكيدك قبل الإجراءات الحسّاسة ما لم
            تأمره بها صراحةً — راجع شارات «نفّذ» في المحادثة لتتبّع كل ما جرى.
          </span>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 'var(--sp-6)', textAlign: 'center' }}><Spinner /></div>
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>

          {/* Panel 1: Executive chat */}
          <div className="card card-pad">
            <div className="row" style={{ gap: 8, marginBottom: 'var(--sp-3)', alignItems: 'center' }}>
              <Icon name="message" size={16} />
              <span className="bold">اسأل، حلّل، ونفّذ — عبر كل المنشآت</span>
              <span className="badge badge-info num" style={{ marginInlineStart: 'auto' }}>{tenants.length} منشأة</span>
            </div>

            {messages.length === 0 && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 'var(--sp-3)' }}>
                {SUGGESTED.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="chip"
                    disabled={busy}
                    onClick={() => (s.includes('…') ? setInput(s) : send(s))}
                    style={{ cursor: 'pointer' }}
                    title={s.includes('…') ? 'قالب — أكمل الفراغ ثم أرسل' : 'تنفيذ مباشر'}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.length > 0 && (
              <div
                ref={scrollRef}
                style={{
                  maxHeight: '55vh', overflowY: 'auto', display: 'flex', flexDirection: 'column',
                  gap: 10, marginBottom: 'var(--sp-3)', paddingInlineEnd: 2,
                }}
              >
                {messages.map((m, i) => {
                  if (m.type === 'action') return <ActionBadge key={i} m={m} />
                  const mine = m.role === 'user'
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '86%', padding: '8px 12px', borderRadius: 14,
                        borderEndEndRadius: mine ? 4 : 14, borderEndStartRadius: mine ? 14 : 4,
                        background: mine ? 'var(--brand)' : 'var(--surface-2)',
                        color: mine ? 'var(--on-brand)' : 'var(--text)',
                        border: mine ? 'none' : '1px solid var(--border)',
                        lineHeight: 1.7, wordBreak: 'break-word',
                      }}>
                        {mine
                          ? <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                          : <div className="small"><Markdown text={m.text} /></div>}
                      </div>
                    </div>
                  )
                })}
                {busy && (
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <Spinner />
                    <span className="xs faint">يحلّل وينفّذ…</span>
                  </div>
                )}
              </div>
            )}

            <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <textarea
                className="textarea grow"
                rows={2}
                placeholder="اكتب أمراً تنفيذياً أو سؤالاً تحليلياً… مثال: أوقف منشأة كذا بسبب عدم السداد"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                disabled={busy}
              />
              <button className="btn btn-primary" onClick={() => send()} disabled={busy}>
                {busy ? <Spinner /> : <><Icon name="sparkles" size={15} /> أرسل</>}
              </button>
            </div>

            {messages.length === 0 && !busy && (
              <div className="xs faint" style={{ marginTop: 'var(--sp-2)' }}>
                يستند المساعد إلى بياناتك الحيّة: {tenants.length} منشأة، وإحصاءات آخر {stats.length} يوم — ويستطيع التنفيذ فعلياً، فراجع طلبك قبل الإرسال.
              </div>
            )}
          </div>

          {/* Panel 2: Error insights (grouping) */}
          <div className="card card-pad">
            <div className="row-between" style={{ marginBottom: 'var(--sp-3)' }}>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <Icon name="warning" size={16} />
                <span className="bold">الأخطاء المتكرّرة</span>
              </div>
              <span className="badge badge-info num">{(errors || []).length}</span>
            </div>

            {errors === null ? (
              <div style={{ padding: 'var(--sp-4)', textAlign: 'center' }}><Spinner /></div>
            ) : groups.length === 0 ? (
              <Empty icon="check" title="لا توجد أخطاء" hint="لم تُسجَّل أي أخطاء في الفترة الأخيرة." />
            ) : (
              <div className="divide">
                {groups.map((g, i) => (
                  <div key={g.sig} className="list-row" style={{ alignItems: 'flex-start', gap: 10 }}>
                    <span className="badge badge-danger num" style={{ flex: 'none', minWidth: 34, textAlign: 'center' }}>
                      ×{g.count}
                    </span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="small bold" style={{ wordBreak: 'break-word' }}>{g.sig}</div>
                      <div className="xs faint" style={{ marginTop: 2 }}>
                        {g.sample?.kind ? <span className="chip xs" style={{ marginInlineEnd: 6 }}>{g.sample.kind}</span> : null}
                        {g.sample?.tenantName ? <span style={{ marginInlineEnd: 6 }}>{g.sample.tenantName}</span> : null}
                        <span className="num">آخر ظهور: {fmtWhen(g.lastAt)}</span>
                      </div>
                    </div>
                    <span className="xs faint num" style={{ flex: 'none' }}>#{i + 1}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
