import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { resolveSlug, getTenant, listTables, createReservation } from '../../lib/db.js'
import { useI18n } from '../../lib/i18n.jsx'
import { FullSpinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { useToast } from '../../components/Toast.jsx'

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// Public advance table booking — /reserve/:slug
export default function BookTable() {
  const { slug } = useParams()
  const { lang } = useI18n()
  const toast = useToast()
  const ar = lang === 'ar'
  const [state, setState] = useState({ loading: true })
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [party, setParty] = useState(2)
  const [date, setDate] = useState(todayStr())
  const [time, setTime] = useState('')
  const [tableId, setTableId] = useState('')
  const [done, setDone] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const tid = await resolveSlug(slug).catch(() => null)
      if (!tid) { if (alive) setState({ loading: false }); return }
      const [tenant, tables] = await Promise.all([getTenant(tid), listTables(tid).catch(() => [])])
      if (alive) setState({ loading: false, tid, tenant, tables })
    })()
    return () => { alive = false }
  }, [slug])

  const submit = async () => {
    if (!name.trim() || !phone.trim() || busy) return
    setBusy(true)
    try {
      const tb = (state.tables || []).find((x) => x.id === tableId)
      const res = await createReservation(state.tid, { kind: 'table', tableId: tableId || null, tableLabel: tb?.label || '', name: name.trim(), phone: phone.trim(), partySize: Number(party) || 1, date, time })
      setDone(res)
    } catch (_) { toast.error(lang === 'ar' ? 'تعذّر إرسال الحجز — حاول مرة أخرى' : 'Booking failed — try again') } finally { setBusy(false) }
  }

  if (state.loading) return <FullSpinner />
  if (!state.tenant) return <div className="container page"><Empty icon="search" title={ar ? 'غير موجود' : 'Not found'} /></div>
  if (done) return (
    <div className="container page stack center" style={{ gap: 'var(--sp-3)', textAlign: 'center', paddingTop: 'var(--sp-8)' }}>
      <div className="center" style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--success-soft)', color: 'var(--success)' }}><Icon name="ok" size={40} /></div>
      <strong style={{ fontSize: 'var(--fs-lg)' }}>{ar ? 'تم استلام طلب الحجز' : 'Booking received'}</strong>
      <p className="muted small">{ar ? `رقم الحجز ${done.code} — ستتواصل معك المنشأة للتأكيد.` : `Booking ${done.code} — the venue will confirm shortly.`}</p>
    </div>
  )

  return (
    <div className="container page stack" style={{ maxWidth: 460, gap: 'var(--sp-3)' }}>
      <div className="stack center" style={{ gap: 4, textAlign: 'center' }}>
        {state.tenant.logoUrl && <img src={state.tenant.logoUrl} alt="" style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover' }} />}
        <strong style={{ fontSize: 'var(--fs-lg)' }}>{state.tenant.name}</strong>
        <span className="muted small">{ar ? 'حجز طاولة مسبق' : 'Reserve a table'}</span>
      </div>
      <div className="field"><label>{ar ? 'الاسم' : 'Name'}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow"><label>{ar ? 'الجوال' : 'Phone'}</label><input className="input num" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="field" style={{ maxWidth: 110 }}><label>{ar ? 'الأشخاص' : 'Party'}</label><input className="input num" type="number" min="1" value={party} onChange={(e) => setParty(e.target.value)} /></div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow"><label>{ar ? 'التاريخ' : 'Date'}</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field grow"><label>{ar ? 'الوقت' : 'Time'}</label><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
      </div>
      {(state.tables || []).length > 0 && (
        <div className="field"><label>{ar ? 'الطاولة (اختياري)' : 'Table (optional)'}</label>
          <select className="select" value={tableId} onChange={(e) => setTableId(e.target.value)}>
            <option value="">{ar ? 'أي طاولة متاحة' : 'Any available'}</option>
            {state.tables.map((tb) => <option key={tb.id} value={tb.id}>{tb.label} · {tb.seats} {ar ? 'مقاعد' : 'seats'}</option>)}
          </select>
        </div>
      )}
      <button className="btn btn-primary btn-block" style={{ minHeight: 46, fontWeight: 800 }} disabled={busy || !name.trim() || !phone.trim()} onClick={submit}>{ar ? 'إرسال طلب الحجز' : 'Request booking'}</button>
    </div>
  )
}
