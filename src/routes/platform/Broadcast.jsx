// Global broadcast — compose one announcement and fan it out to EVERY
// (matching) venue's own announcements board, with optional push to all their
// staff devices. Delivery is done by the onPlatformBroadcast Cloud Function.
import { useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { createBroadcast, watchBroadcasts } from '../../lib/platform.js'
import { PLANS } from '../../lib/plans.js'
import { fmtWhen, PlanBadge } from './shared.jsx'

export default function Broadcast() {
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [plan, setPlan] = useState('')
  const [push, setPush] = useState(true)
  const [days, setDays] = useState(14)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState([])

  useEffect(() => watchBroadcasts(setHistory), [])

  const send = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    const target = plan ? `منشآت باقة «${PLANS.find((p) => p.id === plan)?.ar}» فقط` : 'كل المنشآت النشطة'
    if (!window.confirm(`سيصل هذا الإعلان إلى ${target}${push ? ' + إشعار Push لأجهزة موظفيهم' : ''}. إرسال؟`)) return
    setBusy(true)
    try {
      await createBroadcast({ title: title.trim(), body: body.trim(), plan, push, days })
      setTitle(''); setBody('')
      toast.success('أُرسل الإعلان — تتولى المنصة توزيعه الآن')
    } catch {
      toast.error('تعذّر الإرسال')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      <div>
        <h2 className="page-title">بث إعلان عام</h2>
        <p className="muted small">إعلان واحد يظهر في لوحة إعلانات كل منشأة (مع Push اختياري)</p>
      </div>

      <form className="card card-pad stack" onSubmit={send}>
        <input className="input" placeholder="عنوان الإعلان" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="input" rows={4} placeholder="نص الإعلان… (تحديث جديد، صيانة مجدولة، عرض ترقية…)" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="stack grow" style={{ gap: 4, minWidth: 140 }}>
            <span className="xs faint bold">الفئة المستهدفة</span>
            <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="">كل المنشآت النشطة</option>
              {PLANS.map((p) => <option key={p.id} value={p.id}>باقة {p.ar} فقط</option>)}
            </select>
          </label>
          <label className="stack" style={{ gap: 4, width: 110 }}>
            <span className="xs faint bold">يظهر لمدة (يوم)</span>
            <input type="number" className="input" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <label className="row" style={{ gap: 6, alignItems: 'center', alignSelf: 'flex-end', paddingBottom: 8 }}>
            <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} />
            <span className="small bold">إشعار Push لأجهزتهم</span>
          </label>
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy || !title.trim()}>
          <Icon name="sound" size={16} /> {busy ? 'جارٍ الإرسال…' : 'بث الإعلان'}
        </button>
      </form>

      <div className="card card-pad stack">
        <strong>سجل الإعلانات السابقة</strong>
        {history.length === 0 ? (
          <Empty icon="sound" title="لا إعلانات بعد" />
        ) : (
          <div className="divide">
            {history.map((b) => (
              <div key={b.id} className="row-between" style={{ padding: '8px 0', gap: 8, alignItems: 'flex-start' }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small bold">{b.title}</div>
                  {b.body ? <div className="xs faint" style={{ whiteSpace: 'pre-wrap' }}>{b.body}</div> : null}
                  <div className="xs faint num">{fmtWhen(b.createdAt)}{b.push ? ' · مع Push' : ''}</div>
                </div>
                {b.plan ? <PlanBadge plan={b.plan} /> : <span className="badge">الكل</span>}
                <span className="badge badge-success num">{b.sentTo != null ? `وصل ${b.sentTo}` : 'قيد التوزيع…'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
