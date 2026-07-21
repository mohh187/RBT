// Platform ⇄ venue chat — one thread per venue (thread id == tenantId).
// Threads pane + conversation pane; unread counters live in the thread doc
// and are maintained by the onPlatformChatMessage Cloud Function.
// The conversation itself is the shared ChatThread component.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Empty } from '../../components/ui.jsx'
import { useAuth } from '../../lib/auth.jsx'
import { useToast } from '../../components/Toast.jsx'
import {
  watchAllTenants, watchChatThreads,
  setTenantPlan, setTenantActive, impersonateTenantOwner, platformUpdateTenant,
} from '../../lib/platform.js'
import { fmtWhen, promptSuspendReason } from './shared.jsx'
import ChatThread from '../../components/ChatThread.jsx'

export default function Chat() {
  const { tid } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [threads, setThreads] = useState([])
  const [tenants, setTenants] = useState([])
  const toast = useToast()

  // AI Assistant states
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiModel, setAiModel] = useState('gemini-2.5-flash')
  const [aiLimitDaily, setAiLimitDaily] = useState(100)
  const [aiLimitMonthly, setAiLimitMonthly] = useState(3000)
  const [aiMode, setAiMode] = useState('support')
  const [aiPersona, setAiPersona] = useState('friendly')
  const [aiBlockedKeywords, setAiBlockedKeywords] = useState('')
  const [aiOperatingHours, setAiOperatingHours] = useState('all')
  const [aiSandbox, setAiSandbox] = useState(false)
  const [aiDelayEnabled, setAiDelayEnabled] = useState(false)
  const [aiHandoverEnabled, setAiHandoverEnabled] = useState(true)
  const [aiPrivacyMasking, setAiPrivacyMasking] = useState(true)
  const [actionsOpen, setActionsOpen] = useState(true)

  const nameOf = useMemo(() => {
    const map = {}
    tenants.forEach((t) => { map[t.id] = t.name || t.slug || t.id })
    return map
  }, [tenants])
  const current = useMemo(() => (tid ? tenants.find((t) => t.id === tid) : null), [tid, tenants])

  // Central Management quick action buttons handlers
  const handleImpersonate = async () => {
    if (!tid) return
    if (!window.confirm('هل أنت متأكد من تسجيل الدخول والمحاكاة باسم مالك هذه المنشأة؟')) return
    try {
      await impersonateTenantOwner(tid)
      toast.success('نجحت المحاكاة — سيتم تحويلك الآن')
      setTimeout(() => {
        window.location.href = '/admin'
      }, 800)
    } catch (_) {
      toast.error('فشلت محاكاة تسجيل دخول المالك')
    }
  }

  const toggleActive = async () => {
    if (!tid || !current) return
    const nextActive = current.active === false
    let reason = ''
    if (nextActive) {
      if (!window.confirm(`هل تريد تفعيل حساب «${current.name || tid}» وإعادة تشغيله؟`)) return
    } else {
      reason = promptSuspendReason(current.name || tid)
      if (reason === null) return
    }
    try {
      await setTenantActive(tid, nextActive, reason)
      toast.success('تم تحديث حالة تفعيل المنشأة بنجاح')
    } catch (_) {
      toast.error('تعذّر تحديث حالة المنشأة')
    }
  }

  const updatePlan = async (newPlan) => {
    if (!tid || !current) return
    // billing-impacting: never apply silently from a select change
    if (!window.confirm(`تغيير خطة «${current.name || tid}» إلى ${newPlan}؟`)) return
    try {
      await setTenantPlan(tid, { plan: newPlan })
      toast.success('تم تغيير وتحديث خطة الاشتراك للمنشأة')
    } catch (_) {
      toast.error('فشل تحديث الخطة')
    }
  }

  const updatePlanStatus = async (newStatus) => {
    if (!tid || !current) return
    if (!window.confirm(`تغيير حالة اشتراك «${current.name || tid}» إلى ${newStatus}؟`)) return
    try {
      await setTenantPlan(tid, { planStatus: newStatus })
      toast.success('تم تحديث حالة الاشتراك بنجاح')
    } catch (_) {
      toast.error('فشل تحديث حالة الاشتراك')
    }
  }

  const saveAiConfig = async () => {
    if (!tid) return
    try {
      await platformUpdateTenant(tid, {
        aiConfig: {
          enabled: aiEnabled,
          model: aiModel,
          limitDaily: Number(aiLimitDaily) || 100,
          limitMonthly: Number(aiLimitMonthly) || 3000,
          mode: aiMode,
          persona: aiPersona,
          blockedKeywords: aiBlockedKeywords,
          operatingHours: aiOperatingHours,
          sandbox: aiSandbox,
          delayEnabled: aiDelayEnabled,
          handoverEnabled: aiHandoverEnabled,
          privacyMasking: aiPrivacyMasking
        }
      })
      toast.success('تم حفظ إعدادات المساعد الذكي بنجاح')
    } catch (_) {
      toast.error('تعذّر حفظ إعدادات المساعد الذكي')
    }
  }

  useEffect(() => {
    if (current) {
      const cfg = current.aiConfig || {}
      setAiEnabled(cfg.enabled ?? true)
      setAiModel(cfg.model || 'gemini-2.5-flash')
      setAiLimitDaily(cfg.limitDaily ?? 100)
      setAiLimitMonthly(cfg.limitMonthly ?? 3000)
      setAiMode(cfg.mode || 'support')
      setAiPersona(cfg.persona || 'friendly')
      setAiBlockedKeywords(cfg.blockedKeywords || '')
      setAiOperatingHours(cfg.operatingHours || 'all')
      setAiSandbox(cfg.sandbox ?? false)
      setAiDelayEnabled(cfg.delayEnabled ?? false)
      setAiHandoverEnabled(cfg.handoverEnabled ?? true)
      setAiPrivacyMasking(cfg.privacyMasking ?? true)
    }
  }, [current?.id])

  useEffect(() => watchChatThreads(setThreads), [])
  useEffect(() => watchAllTenants(setTenants), [])

  const commands = [
    { icon: 'waiter', label: 'رسالة ترحيبية', action: () => 'مرحباً بك! كيف يمكن لفريق دعم منصة RBT360 مساعدتك اليوم؟' },
    { icon: 'ok', label: 'تم الحل للمنشأة', action: () => 'تم حل المشكلة التي أشرت إليها بنجاح. يرجى إعلامنا إذا واجهت أي شيء آخر!' },
    { icon: 'zap', label: 'فحص الاتصال', action: () => '[فحص المنصة] اتصال الخادم سليم ومستقر.' },
  ]

  // Venues without a thread yet (start a new conversation).
  const noThread = tenants.filter((t) => !threads.some((th) => th.id === t.id))

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)' }}>
      <div>
        <h2 className="page-title">الدردشة مع المنشآت</h2>
        <p className="muted small">قناة مباشرة بين إدارة المنصة وكل منشأة</p>
      </div>

      <div className="row platform-chat-grid" style={{ alignItems: 'stretch' }}>
        {/* threads pane */}
        <div className="card stack" style={{ flex: '0 0 300px', width: 300, padding: 'var(--sp-2)', gap: 2, maxHeight: '65dvh', overflowY: 'auto' }}>
          {threads.length === 0 && noThread.length === 0 ? (
            <Empty icon="mail" title="لا محادثات بعد" />
          ) : (
            <>
              {threads.map((th) => (
                <Link
                  key={th.id}
                  to={`/platform/chat/${th.id}`}
                  className="list-row"
                  style={th.id === tid ? { background: 'var(--surface-2, var(--bg))', borderRadius: 10 } : {}}
                >
                  <Icon name="store" size={18} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="small bold">{th.tenantName || nameOf[th.id] || th.id}</div>
                    <div className="xs faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {th.lastFrom === 'platform' ? 'أنت: ' : ''}{th.lastText || '—'}
                    </div>
                  </div>
                  <div className="stack" style={{ alignItems: 'flex-end', gap: 2 }}>
                    <span className="xs faint num">{fmtWhen(th.lastAt)}</span>
                    {th.unreadByPlatform ? <span className="badge badge-danger num">{th.unreadByPlatform}</span> : null}
                  </div>
                </Link>
              ))}
              {noThread.length > 0 && (
                <div className="stack" style={{ gap: 4, marginTop: 6 }}>
                  <div className="xs faint bold" style={{ paddingInlineStart: 4 }}>بدء محادثة جديدة</div>
                  <select
                    className="input"
                    value=""
                    onChange={(e) => e.target.value && navigate(`/platform/chat/${e.target.value}`)}
                  >
                    <option value="">اختر منشأة…</option>
                    {noThread.map((t) => <option key={t.id} value={t.id}>{t.name || t.slug}</option>)}
                  </select>
                </div>
              )}
            </>
          )}
        </div>

        {/* conversation pane */}
        <div className="card stack grow" style={{ flex: 1, padding: 'var(--sp-3)', maxHeight: '65dvh' }}>
          {!tid ? (
            <Empty icon="mail" title="اختر محادثة" hint="أو ابدأ محادثة جديدة مع أي منشأة" />
          ) : (
            <>
              <div className="row-between" style={{ paddingBottom: 8, borderBottom: '1px solid var(--border)', flex: 'none' }}>
                <strong>{nameOf[tid] || tid}</strong>
                {current && <Link to={`/platform/venues/${tid}`} className="small bold">ملف المنشأة ←</Link>}
              </div>
              <ChatThread
                key={tid}
                tid={tid}
                side="platform"
                ar
                uid={user?.uid}
                senderName="إدارة المنصة"
                tenantName={nameOf[tid] || ''}
                commands={commands}
                placeholder="اكتب رسالتك الإدارية…"
                emptyHint="ابدأ المحادثة — ستصل رسالتك لمدراء المنشأة فوراً مع إشعار"
              />
            </>
          )}
        </div>

        {/* right administrative actions panel */}
        {tid && current && (
          <div className="card stack" style={{ flex: '0 0 280px', width: 280, maxWidth: '100%', alignSelf: 'flex-start', padding: 'var(--sp-3)', gap: actionsOpen ? 12 : 0, fontSize: 'var(--fs-sm)' }}>
            {/* collapsible so it doesn't bury the conversation when the grid wraps on tablets */}
            <button
              type="button"
              className="row"
              style={{ gap: 6, width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', textAlign: 'start' }}
              onClick={() => setActionsOpen((v) => !v)}
              aria-expanded={actionsOpen}
            >
              <Icon name="settings" size={16} style={{ color: 'var(--brand)' }} />
              <strong className="grow">الإجراءات السريعة للمنصة</strong>
              <Icon name="back" size={14} className="faint" style={{ transform: actionsOpen ? 'rotate(90deg)' : 'rotate(-90deg)', flex: 'none' }} />
            </button>

            {actionsOpen && (<>
            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
              <div className="faint xs">معرّف المنشأة</div>
              <code className="small select-all" style={{ background: 'var(--surface-2)', padding: '2px 4px', borderRadius: 4 }}>{tid}</code>
              <div className="faint xs" style={{ marginTop: 6 }}>رابط المنيو (slug)</div>
              <span className="small bold">{current.slug}</span>
            </div>

            {/* Owner Impersonation */}
            <div>
              <button type="button" className="btn btn-sm btn-outline btn-block text-start" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={handleImpersonate}>
                <Icon name="key" size={13} style={{ verticalAlign: 'middle' }} /> تسجيل الدخول باسم المالك
              </button>
            </div>

            {/* Suspend/Re-activate account */}
            <div className="stack" style={{ gap: 4 }}>
              <span className="faint xs">حالة المنشأة</span>
              <div className="row-between">
                <span className={`badge ${current.active !== false ? 'badge-success' : 'badge-danger'}`}>
                  {current.active !== false ? 'نشط' : 'موقوف'}
                </span>
                <button type="button" className={`btn btn-xs ${current.active !== false ? 'btn-danger' : 'btn-primary'}`} onClick={toggleActive}>
                  {current.active !== false ? 'تجميد الحساب' : 'تفعيل'}
                </button>
              </div>
            </div>

            {/* subscription control */}
            <div className="stack" style={{ gap: 6 }}>
              <span className="faint xs">الخطة الحالية للمنشأة</span>
              <select className="select input-sm" value={current.plan || 'enterprise'} onChange={(e) => updatePlan(e.target.value)}>
                <option value="menu">منيو (Menu)</option>
                <option value="ops">منيو + تشغيل (Operations)</option>
                <option value="pro">احترافي (Pro)</option>
                <option value="enterprise">متكامل (Enterprise)</option>
              </select>

              <span className="faint xs">حالة الاشتراك</span>
              <select className="select input-sm" value={current.planStatus || 'active'} onChange={(e) => updatePlanStatus(e.target.value)}>
                <option value="active">نشط (Active)</option>
                <option value="trial">تجريبي (Trial)</option>
                <option value="expired">منتهٍ (Expired)</option>
              </select>
            </div>

            {/* AI Assistant Configuration */}
            <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12, maxHeight: '35dvh', overflowY: 'auto', paddingInlineEnd: 4 }}>
              <div className="row" style={{ gap: 6 }}>
                <Icon name="sparkles" size={14} style={{ color: 'var(--brand)' }} />
                <strong>المساعد الذكي (AI) - إدارة كاملة</strong>
              </div>

              <label className="row" style={{ gap: 6, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
                <span>تمكين المساعد الذكي للمنشأة</span>
              </label>

              <div className="stack" style={{ gap: 4 }}>
                <span className="faint xs">طراز نموذج الذكاء الاصطناعي</span>
                <select className="select input-sm" value={aiModel} onChange={(e) => setAiModel(e.target.value)}>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash (افتراضي)</option>
                  <option value="gemini-pro-latest">Gemini Pro (ذكي)</option>
                  <option value="gpt-4o-mini">GPT-4o Mini (سريع)</option>
                  <option value="gpt-4o">GPT-4o (شامل قوي)</option>
                </select>
              </div>

              <div className="stack" style={{ gap: 4 }}>
                <span className="faint xs">صلاحية/وظيفة المساعد</span>
                <select className="select input-sm" value={aiMode} onChange={(e) => setAiMode(e.target.value)}>
                  <option value="support">خدمة العملاء والدعم الفني</option>
                  <option value="menu">مساعد الطلبات والمنيو فقط</option>
                  <option value="all">دعم شامل (عملاء + إدارة)</option>
                </select>
              </div>

              <div className="stack" style={{ gap: 4 }}>
                <span className="faint xs">نبرة وشخصية المساعد</span>
                <select className="select input-sm" value={aiPersona} onChange={(e) => setAiPersona(e.target.value)}>
                  <option value="friendly">ودي وترحابي</option>
                  <option value="formal">مهني ورسمي</option>
                  <option value="funny">مرح وفكاهي</option>
                  <option value="classic">كلاسيكي وموجز</option>
                </select>
              </div>

              <div className="stack" style={{ gap: 4 }}>
                <span className="faint xs">ساعات عمل الذكاء الاصطناعي</span>
                <select className="select input-sm" value={aiOperatingHours} onChange={(e) => setAiOperatingHours(e.target.value)}>
                  <option value="all">طوال اليوم 24/7</option>
                  <option value="working">ساعات العمل الرسمية فقط</option>
                  <option value="non-working">خارج ساعات العمل فقط</option>
                </select>
              </div>

              <div className="row" style={{ gap: 8 }}>
                <div className="grow stack" style={{ gap: 2 }}>
                  <span className="faint xs">الحد اليومي</span>
                  <input type="number" className="input input-sm" style={{ padding: '4px 6px' }} value={aiLimitDaily} onChange={(e) => setAiLimitDaily(e.target.value)} />
                </div>
                <div className="grow stack" style={{ gap: 2 }}>
                  <span className="faint xs">الحد الشهري</span>
                  <input type="number" className="input input-sm" style={{ padding: '4px 6px' }} value={aiLimitMonthly} onChange={(e) => setAiLimitMonthly(e.target.value)} />
                </div>
              </div>

              <div className="stack" style={{ gap: 4 }}>
                <span className="faint xs">منع كلمات دلالية (مفصولة بفاصلة)</span>
                <textarea className="input input-sm" rows={2} style={{ fontSize: 12, padding: '4px 6px' }} placeholder="منافسين، شتائم..." value={aiBlockedKeywords} onChange={(e) => setAiBlockedKeywords(e.target.value)} />
              </div>

              <label className="row" style={{ gap: 6, cursor: 'pointer', fontSize: 12 }}>
                <input type="checkbox" checked={aiSandbox} onChange={(e) => setAiSandbox(e.target.checked)} />
                <span>وضع الاختبار والـ Sandbox</span>
              </label>

              <label className="row" style={{ gap: 6, cursor: 'pointer', fontSize: 12 }}>
                <input type="checkbox" checked={aiDelayEnabled} onChange={(e) => setAiDelayEnabled(e.target.checked)} />
                <span>تفعيل محاكاة الكتابة البشرية (Delay)</span>
              </label>

              <label className="row" style={{ gap: 6, cursor: 'pointer', fontSize: 12 }}>
                <input type="checkbox" checked={aiHandoverEnabled} onChange={(e) => setAiHandoverEnabled(e.target.checked)} />
                <span>تحويل تلقائي للبشري عند الغضب/الشكوى</span>
              </label>

              <label className="row" style={{ gap: 6, cursor: 'pointer', fontSize: 12 }}>
                <input type="checkbox" checked={aiPrivacyMasking} onChange={(e) => setAiPrivacyMasking(e.target.checked)} />
                <span>تعتيم وحجب البيانات الحساسة (Privacy)</span>
              </label>

              <button type="button" className="btn btn-xs btn-primary btn-block" style={{ marginTop: 4 }} onClick={saveAiConfig}>
                حفظ تفاصيل المساعد
              </button>
            </div>
            </>)}
          </div>
        )}
      </div>
    </div>
  )
}
