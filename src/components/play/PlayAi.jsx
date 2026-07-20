// «تحليل بالذكاء» — the model tab.
//
// The contract enforced here, mechanically and not by trust:
//   • the model receives ONE snapshot object and nothing else. No raw plays, no
//     phone numbers, no guest names.
//   • the exact snapshot that was sent is frozen onto the reply and shown under
//     a mandatory «الأرقام المستخدمة» block, so any claim can be checked against
//     the figures it was supposedly built from.
//   • a proposed audience is never taken from the model's prose. It may only
//     NAME a segmentId that already exists; the phone list is resolved locally
//     from real rows. An unknown id is rejected and the rejection is displayed.
import { useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { fmtNum } from '../../lib/format.js'
import { aiQuick, aiConfigured } from '../../lib/aiBridge.js'
import { buildPlayPrompt, parsePlayReply, THIN_PLAYS } from './engine.jsx'
import { SegmentCard } from './PlaySegments.jsx'

const QUICK_AR = [
  'ما الذي تقوله أرقام الألعاب عن زبائني؟',
  'أي لعبة تستحق جائزة أو مسابقة؟',
  'لماذا لا يُنهي الضيوف اللعبة؟',
  'ما الفجوة المعرفية في قائمتي؟',
  'اقترح حملة لشريحة موجودة فعلاً',
]

export default function PlayAi({
  snapshot, segments = [], findings = [], guard = '',
  ar = true, allowed = true, disabledReason = '', periodLabel = '',
  onCreateCampaign,
}) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [openSnap, setOpenSnap] = useState(-1)
  const boxRef = useRef(null)

  const configured = aiConfigured()
  const blocked = !allowed || !configured
  const samplePlays = Number(snapshot && snapshot.sampleSize && snapshot.sampleSize.plays) || 0

  const ask = async (question) => {
    const q = String(question == null ? input : question).trim()
    if (!q || busy || blocked || !snapshot) return
    setInput('')
    const snap = snapshot // frozen with the message: the numbers block cannot drift
    const segs = segments
    setMessages((m) => [...m, { role: 'user', text: q }])
    setBusy(true)
    try {
      const reply = await aiQuick(buildPlayPrompt(guard, snap, q), { model: 'gemini-2.5-flash' })
      const parsed = parsePlayReply(reply, segs)
      setMessages((m) => [...m, {
        role: 'ai',
        text: parsed.text || (ar ? 'لم يصل رد من النموذج. أعد المحاولة.' : 'No reply.'),
        segment: parsed.segment,
        rejected: parsed.rejected,
        snapshot: snap,
      }])
    } catch (e) {
      setMessages((m) => [...m, {
        role: 'error',
        text: (ar ? 'تعذّر الوصول إلى المساعد: ' : 'Assistant unavailable: ') + (e && e.message ? e.message : String(e)),
      }])
    } finally {
      setBusy(false)
      requestAnimationFrame(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight })
    }
  }

  return (
    <div className="gp-stack">
      {/* Findings first, on purpose: the honest answer usually needs no model. */}
      {findings.length > 0 && (
        <div className="gp-card">
          <span className="gp-card-t"><Icon name="notepad" size={17} /> {ar ? 'استنتاجات بلا ذكاء اصطناعي' : 'Rule findings'}</span>
          <p className="gp-hint">
            {ar
              ? 'محسوبة بقواعد ثابتة من محاولات هذه الفترة. تبقى صحيحة حتى لو كان المساعد الذكي متوقفاً تماماً.'
              : 'Fixed rules over this period. Valid with or without the AI.'}
          </p>
          <div className="gp-findings">
            {findings.map((f) => (
              <div className={`gp-finding is-${f.tone}`} key={f.key}>
                <Icon name={f.tone === 'good' ? 'check' : (f.tone === 'neutral' ? 'notepad' : 'warning')} size={15} />
                <div>
                  <strong>{f.title}</strong>
                  <p>{f.body}</p>
                  <span className="gp-of gp-num">{ar ? 'حجم العينة' : 'sample'} {fmtNum(f.sample)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="gp-card">
        <span className="gp-card-t"><Icon name="sparkles" size={17} /> {ar ? 'تحليل بالذكاء' : 'AI analysis'}</span>
        <p className="gp-hint">
          {ar
            ? 'يجيب من أرقام هذه الفترة فقط. تُرسَل إليه لقطة واحدة من الأرقام المحسوبة على هذه الصفحة، مع منع صريح لاختراع أي رقم أو ربط النتائج بالأبراج أو أي ادعاء غيبي. لا يُرسَل إليه أي اسم ضيف ولا أي رقم جوال. تظهر «الأرقام المستخدمة» تحت كل إجابة لتراجعها بنفسك.'
            : 'Answers only from this period\'s computed figures. No guest names or phones are ever sent. The exact snapshot is attached to every reply.'}
        </p>

        {blocked && (
          <div className="gp-warn">
            <Icon name="warning" size={15} />
            <span>{disabledReason || (ar
              ? 'المساعد الذكي غير مُهيَّأ في هذه البيئة — الاستنتاجات أعلاه والشرائح تعمل بدونه تماماً.'
              : 'AI unavailable — findings and segments work without it.')}</span>
          </div>
        )}
        {!blocked && samplePlays === 0 && (
          <div className="gp-warn">
            <Icon name="warning" size={15} />
            <span>{ar ? 'لا محاولات في هذه الفترة، فلا توجد أرقام يبني عليها التحليل. وسّع الفترة أولاً.' : 'No plays in this period.'}</span>
          </div>
        )}
        {!blocked && samplePlays > 0 && samplePlays < THIN_PLAYS && (
          <div className="gp-warn">
            <Icon name="warning" size={15} />
            <span>{ar
              ? `الفترة تحوي ${fmtNum(samplePlays)} محاولة فقط. اللقطة مُعلَّمة thinSample، والنموذج مُلزَم بقول «العينة غير كافية» بدل بناء خطة على أرقام هشّة.`
              : `Only ${fmtNum(samplePlays)} plays — the snapshot is flagged thin.`}</span>
          </div>
        )}

        <div className="gp-chat" ref={boxRef}>
          {!messages.length ? (
            <p className="gp-hint">{ar ? 'اسأل عن أي شيء في نشاط الألعاب، أو ابدأ من الاقتراحات أسفل.' : 'Ask anything about play activity.'}</p>
          ) : messages.map((m, i) => (
            <div className={`gp-msg is-${m.role}`} key={i}>
              <div className="gp-msg-body">{m.text}</div>

              {Array.isArray(m.rejected) && m.rejected.length > 0 && (
                <div className="gp-warn">
                  <Icon name="warning" size={14} />
                  <span>{ar ? 'رُفض جزء من مخرجات النموذج لأنه لا يطابق البيانات: ' : 'Rejected model output: '}{m.rejected.join(' · ')}</span>
                </div>
              )}

              {m.segment && (
                <SegmentCard
                  seg={m.segment} ar={ar} source="guest-play-ai"
                  onCreateCampaign={onCreateCampaign} periodLabel={periodLabel}
                />
              )}

              {m.snapshot && (
                <>
                  <button
                    type="button" className="gp-snap-toggle"
                    onClick={() => setOpenSnap(openSnap === i ? -1 : i)}
                    aria-expanded={openSnap === i}
                  >
                    <Icon name={openSnap === i ? 'arrowUpDown' : 'next'} size={12} />
                    {ar ? 'الأرقام المستخدمة' : 'Numbers used'}
                  </button>
                  {openSnap === i && (
                    <pre className="gp-snap" dir="ltr">{JSON.stringify(m.snapshot, null, 2)}</pre>
                  )}
                </>
              )}
            </div>
          ))}
          {busy && (
            <div className="gp-msg is-ai">
              <div className="gp-msg-body">{ar ? 'يقرأ أرقام الألعاب' : 'Reading play data'}<span className="gp-dots" /></div>
            </div>
          )}
        </div>

        <div className="gp-scroll-x">
          <div className="gp-quick">
            {QUICK_AR.map((p) => (
              <button key={p} type="button" className="chip" disabled={busy || blocked || !snapshot} onClick={() => ask(p)}>{p}</button>
            ))}
          </div>
        </div>

        <form className="gp-ask" onSubmit={(e) => { e.preventDefault(); ask() }}>
          <input
            className="input" value={input} onChange={(e) => setInput(e.target.value)}
            placeholder={ar ? 'اكتب سؤالك عن نشاط الألعاب' : 'Ask about play activity'}
            disabled={busy || blocked}
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy || blocked || !input.trim()}>
            <Icon name="next" size={15} /> {ar ? 'اسأل' : 'Ask'}
          </button>
        </form>
      </div>

      {/* The same segments as the segments tab, reachable without asking anything. */}
      {segments.length > 0 && (
        <div className="gp-card">
          <span className="gp-card-t"><Icon name="layers" size={17} /> {ar ? 'شرائح جاهزة بلا سؤال' : 'Segments, no question needed'}</span>
          <div className="gp-two">
            {segments.slice(0, 4).map((s) => (
              <SegmentCard key={s.id} seg={s} ar={ar} onCreateCampaign={onCreateCampaign} periodLabel={periodLabel} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
