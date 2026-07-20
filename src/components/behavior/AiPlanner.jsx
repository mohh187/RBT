import { useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { fmtNum } from '../../lib/format.js'
import { aiQuick, aiConfigured } from '../../lib/aiBridge.js'
import { buildPlannerPrompt, parsePlan } from './engine.jsx'

const QUICK_AR = [
  'ما أكبر تسريب في مسار الشراء؟',
  'خطة لرفع التحويل',
  'حملة للفئة التي شاهدت ولم تطلب',
  'ما الأصناف التي يبحث عنها الناس ولا نقدمها؟',
  'خطة محتوى لأسبوع',
]

const TONE_ICON = { bad: 'warning', warn: 'warning', good: 'check', neutral: 'notepad' }

// The model never queries anything. It receives ONE JSON snapshot built from the
// figures rendered on the other tabs, under a hard guard, and every reply ships
// with that exact snapshot attached. Audiences are never taken from the model's
// prose: it may only pick a segmentId that already exists in the snapshot, and
// the phone list is resolved locally from the real sessions.
export default function AiPlanner({
  snapshot, segments = [], itemRows = [], findings = [], guard = '',
  ar = true, allowed = true, disabledReason = '', periodLabel = '',
  onCreateCampaign, onCreateContent,
}) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [openSnap, setOpenSnap] = useState(-1)
  const [manualSeg, setManualSeg] = useState('')
  const boxRef = useRef(null)

  const configured = aiConfigured()
  const blocked = !allowed || !configured
  // The shared snapshot names it `sample`, the local one `sampleSize`; read both.
  const sample = Number(snapshot?.sampleSize?.sessions ?? snapshot?.sample?.sessions) || 0

  const ask = async (question) => {
    const q = String(question ?? input).trim()
    if (!q || busy || blocked || !snapshot) return
    setInput('')
    const snap = snapshot // frozen with the message so the numbers block always matches
    const segs = segments
    setMessages((m) => [...m, { role: 'user', text: q }])
    setBusy(true)
    try {
      const reply = await aiQuick(buildPlannerPrompt(guard, snap, q), { model: 'gemini-2.5-flash' })
      const parsed = parsePlan(reply, segs, itemRows)
      setMessages((m) => [...m, {
        role: 'ai',
        text: parsed.text || (ar ? 'لم يصل رد من النموذج. أعد المحاولة.' : 'No reply.'),
        campaign: parsed.campaign,
        content: parsed.content,
        rejected: parsed.rejected,
        snapshot: snap,
      }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'error', text: (ar ? 'تعذّر الوصول إلى المساعد: ' : 'Assistant unavailable: ') + (e?.message || e) }])
    } finally {
      setBusy(false)
      requestAnimationFrame(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight })
    }
  }

  const prepareCampaign = (draft) => {
    if (typeof onCreateCampaign !== 'function') return
    onCreateCampaign(draft)
  }

  const manual = segments.find((s) => s.id === manualSeg) || null

  return (
    <div className="bhv-stack">
      {/* Rule findings: computed locally, always true, never depend on the model. */}
      <div className="bhv-card">
        <span className="bhv-card-t"><Icon name="notepad" size={17} /> {ar ? 'ما تقوله الأرقام بلا ذكاء اصطناعي' : 'What the numbers already say'}</span>
        <p className="bhv-hint">
          {ar
            ? 'هذه الاستنتاجات محسوبة بقواعد ثابتة من جلسات هذه الفترة، وتبقى صحيحة حتى لو كان المساعد الذكي متوقفاً.'
            : 'Rule-derived findings. Valid with or without the AI.'}
        </p>
        {!findings.length ? (
          <p className="bhv-hint">{ar ? 'لا بيانات كافية لاستخراج أي استنتاج بعد.' : 'Not enough data yet.'}</p>
        ) : (
          <div className="bhv-findings">
            {findings.map((f) => (
              <div className={`bhv-finding is-${f.tone}`} key={f.key}>
                <Icon name={TONE_ICON[f.tone] || 'notepad'} size={14} />
                <div>
                  <strong>{f.title}</strong>
                  <p>{f.body}</p>
                  <span className="bhv-of bhv-num">{ar ? 'حجم العينة' : 'sample'} {fmtNum(f.sample)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Audience builder: works with zero AI involvement. */}
      <div className="bhv-card">
        <span className="bhv-card-t"><Icon name="customers" size={17} /> {ar ? 'بناء جمهور حقيقي' : 'Build a real audience'}</span>
        <p className="bhv-hint">
          {ar
            ? 'كل شريحة هنا قائمة فعلية من الجلسات، محوّلة إلى أرقام جوال حقيقية بعد إزالة التكرار. المجهولون بلا رقم يظهرون بوضوح لأنه لا يمكن مراسلتهم.'
            : 'Every segment is a real, de-duplicated list of phone numbers.'}
        </p>
        {!segments.length ? (
          <p className="bhv-hint">{ar ? 'لا شرائح — لا توجد جلسات في الفترة.' : 'No segments.'}</p>
        ) : (
          <>
            <select className="input" value={manualSeg} onChange={(e) => setManualSeg(e.target.value)}>
              <option value="">{ar ? 'اختر شريحة' : 'Pick a segment'}</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.ar} — {fmtNum(s.sessionCount)} {ar ? 'جلسة' : 'sessions'}
                </option>
              ))}
            </select>
            {manual && (
              <Audience
                seg={manual} ar={ar}
                onPrepare={() => prepareCampaign({
                  title: manual.ar,
                  message: '',
                  timing: '',
                  itemIds: manual.itemIds,
                  segmentId: manual.id,
                  segmentLabel: manual.ar,
                  segmentWhy: manual.why,
                  audience: { phones: manual.phones, count: manual.phones.length, anonymousDevices: manual.anonymousDevices, sessionCount: manual.sessionCount },
                  source: 'behavior',
                  period: periodLabel,
                })}
                canPrepare={typeof onCreateCampaign === 'function'}
              />
            )}
          </>
        )}
      </div>

      {/* The planner itself */}
      <div className="bhv-card">
        <span className="bhv-card-t"><Icon name="sparkles" size={17} /> {ar ? 'المخطِّط الذكي' : 'AI growth planner'}</span>
        <p className="bhv-hint">
          {ar
            ? 'يجيب من أرقام هذه الفترة فقط. تُرسَل إليه لقطة واحدة من الأرقام المحسوبة هنا مع منع صريح لاختراع أي رقم، وتظهر «الأرقام المستخدمة» تحت كل إجابة لتراجعها بنفسك.'
            : 'Answers only from this period\'s computed figures; the exact snapshot is attached to every reply.'}
        </p>

        {blocked && (
          <div className="bhv-warn">
            <Icon name="warning" size={15} />
            <span>{disabledReason || (ar ? 'المساعد الذكي غير مُهيَّأ في هذه البيئة — الاستنتاجات أعلاه وبناء الجمهور يعملان بدونه.' : 'AI unavailable.')}</span>
          </div>
        )}
        {!blocked && sample === 0 && (
          <div className="bhv-warn">
            <Icon name="warning" size={15} />
            <span>{ar ? 'لا جلسات في هذه الفترة، فلا توجد أرقام يبني عليها المخطِّط. وسّع الفترة أولاً.' : 'No sessions in this period.'}</span>
          </div>
        )}
        {!blocked && sample > 0 && sample < 20 && (
          <div className="bhv-warn">
            <Icon name="warning" size={15} />
            <span>{ar ? `الفترة تحوي ${fmtNum(sample)} جلسة فقط. المخطِّط مُلزَم بأن يقول «العينة غير كافية» بدل بناء خطة على أرقام هشّة.` : `Only ${fmtNum(sample)} sessions in period.`}</span>
          </div>
        )}

        <div className="bhv-chat bhv-scroll-y" ref={boxRef}>
          {!messages.length ? (
            <p className="bhv-hint">{ar ? 'اسأل عن أي شيء في سلوك زوّارك، أو ابدأ من الاقتراحات أسفل.' : 'Ask anything about guest behaviour.'}</p>
          ) : messages.map((m, i) => (
            <div className={`bhv-msg is-${m.role}`} key={i}>
              <div className="bhv-msg-body">{m.text}</div>

              {Array.isArray(m.rejected) && m.rejected.length > 0 && (
                <div className="bhv-warn">
                  <Icon name="warning" size={14} />
                  <span>{ar ? 'رُفض جزء من مخرجات النموذج لأنه لا يطابق البيانات: ' : 'Rejected model output: '}{m.rejected.join(' · ')}</span>
                </div>
              )}

              {m.campaign && (
                <CampaignDraft
                  c={m.campaign} itemRows={itemRows} ar={ar} periodLabel={periodLabel}
                  canPrepare={typeof onCreateCampaign === 'function'}
                  onPrepare={prepareCampaign}
                />
              )}

              {m.content && (
                <ContentBrief
                  k={m.content} itemRows={itemRows} ar={ar} periodLabel={periodLabel}
                  canPrepare={typeof onCreateContent === 'function'}
                  onPrepare={(d) => onCreateContent && onCreateContent(d)}
                />
              )}

              {m.snapshot && (
                <>
                  <button type="button" className="bhv-snap-toggle" onClick={() => setOpenSnap(openSnap === i ? -1 : i)} aria-expanded={openSnap === i}>
                    <Icon name={openSnap === i ? 'arrowUpDown' : 'next'} size={12} />
                    {ar ? 'الأرقام المستخدمة' : 'Numbers used'}
                  </button>
                  {openSnap === i && <pre className="bhv-snap bhv-scroll-y" dir="ltr">{JSON.stringify(m.snapshot, null, 2)}</pre>}
                </>
              )}
            </div>
          ))}
          {busy && <div className="bhv-msg is-ai"><div className="bhv-msg-body">{ar ? 'يقرأ سلوك الزوّار' : 'Reading behaviour'}<span className="bhv-dots">...</span></div></div>}
        </div>

        <div className="bhv-scroll-x">
          <div className="bhv-quick">
            {QUICK_AR.map((p) => (
              <button key={p} type="button" className="chip" disabled={busy || blocked || !snapshot} onClick={() => ask(p)}>{p}</button>
            ))}
          </div>
        </div>

        <form className="bhv-ask" onSubmit={(e) => { e.preventDefault(); ask() }}>
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={ar ? 'اكتب سؤالك عن سلوك الزوّار' : 'Ask about guest behaviour'}
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

// The honest part: reachable vs unreachable, with a real sample of the numbers.
function Audience({ seg, ar, onPrepare, canPrepare }) {
  const reach = seg.phones.length
  const total = reach + seg.anonymousDevices
  return (
    <div className="bhv-aud">
      <p className="bhv-hint">{seg.why}</p>
      <div className="bhv-aud-nums">
        <span><b className="bhv-num">{fmtNum(seg.sessionCount)}</b> {ar ? 'جلسة مطابقة' : 'matching sessions'}</span>
        <span className="is-ok"><b className="bhv-num">{fmtNum(reach)}</b> {ar ? 'رقم جوال حقيقي (يمكن مراسلته)' : 'reachable phones'}</span>
        <span className="is-no"><b className="bhv-num">{fmtNum(seg.anonymousDevices)}</b> {ar ? 'جهاز مجهول بلا رقم (لا يمكن مراسلته)' : 'anonymous, unreachable'}</span>
        {total > 0 && <span className="bhv-of">{ar ? 'نسبة القابلين للوصول' : 'reachable'} <b className="bhv-num">{fmtNum(Math.round((reach / total) * 100))}%</b></span>}
      </div>
      {reach > 0 && (
        <div className="bhv-qchips">
          {seg.phones.slice(0, 6).map((p) => (
            <span className="bhv-qchip bhv-num" key={p.phone}>{maskPhone(p.phone)}{p.name ? ` · ${p.name}` : ''}</span>
          ))}
          {reach > 6 && <span className="bhv-qchip bhv-num">+{fmtNum(reach - 6)}</span>}
        </div>
      )}
      {canPrepare ? (
        <button type="button" className="btn btn-sm btn-primary" disabled={!reach} onClick={onPrepare}>
          <Icon name="message" size={15} /> {ar ? 'جهّز الحملة' : 'Prepare campaign'}
        </button>
      ) : (
        <p className="bhv-hint">{ar ? 'صفحة الحملات غير موصولة بهذه الشاشة بعد.' : 'Campaigns page not wired yet.'}</p>
      )}
      {!reach && <p className="bhv-hint">{ar ? 'لا يمكن إطلاق حملة: كل من في هذه الشريحة مجهولون بلا رقم جوال.' : 'No reachable phones in this segment.'}</p>}
    </div>
  )
}

const maskPhone = (p) => {
  const s = String(p || '')
  return s.length > 6 ? `${s.slice(0, 5)}***${s.slice(-3)}` : s
}

function CampaignDraft({ c, itemRows, ar, periodLabel, onPrepare, canPrepare }) {
  const names = c.itemIds.map((id) => (itemRows.find((r) => r.itemId === id) || {}).name || id)
  const seg = c.segment
  return (
    <div className="bhv-draft">
      <span className="bhv-draft-t"><Icon name="message" size={14} /> {ar ? 'مسودة حملة جاهزة' : 'Campaign draft'}</span>
      <strong className="bhv-draft-title">{c.title}</strong>
      {c.message && <p className="bhv-draft-msg">{c.message}</p>}
      <div className="bhv-facts">
        {c.timing && <span>{ar ? 'التوقيت المقترح' : 'Timing'} <b>{c.timing}</b></span>}
        {names.length > 0 && <span>{ar ? 'الأصناف' : 'Items'} <b>{names.join(' · ')}</b></span>}
      </div>
      {seg ? (
        <Audience
          seg={seg} ar={ar} canPrepare={canPrepare}
          onPrepare={() => onPrepare({
            title: c.title,
            message: c.message,
            timing: c.timing,
            itemIds: c.itemIds,
            itemNames: names,
            segmentId: seg.id,
            segmentLabel: seg.ar,
            segmentWhy: seg.why,
            audience: { phones: seg.phones, count: seg.phones.length, anonymousDevices: seg.anonymousDevices, sessionCount: seg.sessionCount },
            source: 'behavior-ai',
            period: periodLabel,
          })}
        />
      ) : (
        <div className="bhv-warn">
          <Icon name="warning" size={14} />
          <span>{ar ? 'لم يحدّد النموذج شريحة معروفة، فلا جمهور حقيقي لهذه المسودة. اختر شريحة يدوياً من «بناء جمهور حقيقي» أعلاه.' : 'No known segment — pick one manually above.'}</span>
        </div>
      )}
    </div>
  )
}

function ContentBrief({ k, itemRows, ar, periodLabel, onPrepare, canPrepare }) {
  const names = (k.itemIds || []).map((id) => (itemRows.find((r) => r.itemId === id) || {}).name || id)
  return (
    <div className="bhv-draft is-content">
      <span className="bhv-draft-t"><Icon name="image" size={14} /> {ar ? 'بريف محتوى' : 'Content brief'}</span>
      {k.subject && <strong className="bhv-draft-title">{k.subject}</strong>}
      {k.style && <p className="bhv-hint">{ar ? 'الأسلوب البصري: ' : 'Style: '}{k.style}</p>}
      {k.caption && <p className="bhv-draft-msg">{k.caption}</p>}
      {names.length > 0 && <p className="bhv-hint">{ar ? 'الأصناف: ' : 'Items: '}{names.join(' · ')}</p>}
      {canPrepare ? (
        <button type="button" className="btn btn-sm btn-outline" onClick={() => onPrepare({ ...k, itemNames: names, source: 'behavior-ai', period: periodLabel })}>
          <Icon name="sparkles" size={15} /> {ar ? 'صمّم بالذكاء' : 'Design with AI'}
        </button>
      ) : (
        <p className="bhv-hint">{ar ? 'أداة التصميم غير موصولة بهذه الشاشة بعد.' : 'Design tool not wired yet.'}</p>
      )}
    </div>
  )
}
