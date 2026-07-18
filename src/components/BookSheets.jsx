import { useEffect, useMemo, useState } from 'react'
import { useI18n, pickLang } from '../lib/i18n.jsx'
import { useToast } from './Toast.jsx'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { Empty, Spinner, Stepper } from './ui.jsx'
import { Price } from './Riyal.jsx'
import { watchEvents, createTicket, createReservation } from '../lib/db.js'
import { getLocalCustomer, setLocalCustomer } from '../lib/customer.js'

function fmtDate(ts, lang) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
  if (!d) return ''
  return d.toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

// Events list + ticket booking as a bottom sheet (opens instantly, no page load).
export function EventsSheet({ tenantId, currency = 'SAR', onClose, onBooked }) {
  const { t, lang } = useI18n()
  const [events, setEvents] = useState(null)
  const [active, setActive] = useState(null)

  useEffect(() => { if (tenantId) return watchEvents(tenantId, setEvents) }, [tenantId])
  const published = useMemo(() => (events || []).filter((e) => e.status === 'published'), [events])

  if (active) return <BookTicketSheet event={active} tenantId={tenantId} currency={currency} onClose={() => setActive(null)} onBooked={onBooked} />

  return (
    <Sheet open onClose={onClose} title={t('events')}>
      {events === null ? (
        <Spinner />
      ) : published.length === 0 ? (
        <Empty icon="events" title={t('noEvents')} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          {published.map((e) => (
            <button key={e.id} className="card" onClick={() => setActive(e)} style={{ overflow: 'hidden', textAlign: 'start' }}>
              {e.imageUrl && <img src={e.imageUrl} alt="" style={{ width: '100%', height: 140, objectFit: 'cover' }} />}
              <div className="card-pad stack" style={{ gap: 6 }}>
                <strong style={{ fontSize: 'var(--fs-md)' }}>{pickLang(e, 'title', lang)}</strong>
                <span className="small muted"><Icon name="calendar" size={14} /> {fmtDate(e.startsAt, lang)}</span>
                {e.location && <span className="xs faint"><Icon name="pin" size={13} /> {e.location}</span>}
                <span className="badge" style={{ width: 'fit-content' }}>{t('getTicket')}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}

function BookTicketSheet({ event, tenantId, currency, onClose, onBooked }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const local = getLocalCustomer()
  const types = event.ticketTypes?.length ? event.ticketTypes : [{ key: 't0', nameAr: lang === 'ar' ? 'دخول عام' : 'General', price: 0 }]
  const [type, setType] = useState(types[0])
  const [name, setName] = useState(local?.name || '')
  const [phone, setPhone] = useState(local?.phone || '')
  const [busy, setBusy] = useState(false)

  const book = async () => {
    if (!name.trim() && !phone.trim()) { toast.error(lang === 'ar' ? 'أدخل الاسم أو الجوال' : 'Enter name or phone'); return }
    setBusy(true)
    try {
      const res = await createTicket(tenantId, {
        eventId: event.id, eventTitleAr: event.titleAr || '', eventTitleEn: event.titleEn || '',
        startsAt: event.startsAt || null, typeKey: type.key, typeName: pickLang(type, 'name', lang),
        price: Number(type.price) || 0, name: name.trim(), phone: phone.trim(),
      })
      onBooked(res.id)
    } catch (_) {
      toast.error(t('error')); setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={pickLang(event, 'title', lang)}
      footer={<button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={book}>{busy ? t('saving') : <>{t('getTicket')}{type.price ? <> · <Price value={type.price} currency={currency} lang={lang} /></> : ''}</>}</button>}>
      <div className="stack">
        {event.imageUrl && <img src={event.imageUrl} alt="" style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 'var(--r-lg)' }} />}
        <span className="small muted"><Icon name="calendar" size={14} /> {fmtDate(event.startsAt, lang)}</span>
        {event.descAr && <p className="muted small">{event.descAr}</p>}
        {types.length > 1 && (
          <div className="field">
            <label>{t('ticketTypes')}</label>
            <div className="row wrap" style={{ gap: 8 }}>
              {types.map((ty) => (
                <button key={ty.key} className={`chip ${type.key === ty.key ? 'active' : ''}`} onClick={() => setType(ty)}>
                  {pickLang(ty, 'name', lang)}{ty.price ? <> · <Price value={ty.price} currency={currency} lang={lang} /></> : ''}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field"><label>{t('yourName')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>{t('phone')}</label><input className="input num" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
      </div>
    </Sheet>
  )
}

const OCCASIONS = [
  { id: 'birthday', icon: 'cake' },
  { id: 'gathering', icon: 'customers' },
  { id: 'meeting', icon: 'user' },
  { id: 'other', icon: 'star' },
]

// Occasion reservation booking as a bottom sheet (same mechanism as events).
export function ReserveSheet({ tenantId, onClose, onBooked }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const local = getLocalCustomer()
  const [occasion, setOccasion] = useState('birthday')
  const [dateTime, setDateTime] = useState('')
  const [partySize, setPartySize] = useState(4)
  const [name, setName] = useState(local?.name || '')
  const [phone, setPhone] = useState(local?.phone || '')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim() || !phone.trim()) { toast.error(lang === 'ar' ? 'الاسم والجوال مطلوبان' : 'Name and phone required'); return }
    if (!dateTime) { toast.error(lang === 'ar' ? 'اختر التاريخ والوقت' : 'Pick a date & time'); return }
    setBusy(true)
    try {
      const res = await createReservation(tenantId, { occasion, dateTime: new Date(dateTime), partySize, name: name.trim(), phone: phone.trim(), notes: notes.trim() })
      setLocalCustomer({ name: name.trim(), phone: phone.trim() })
      onBooked(res.id)
    } catch (_) {
      toast.error(t('error')); setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={t('bookOccasion')}
      footer={<button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={submit}>{busy ? t('saving') : t('sendRequest')}</button>}>
      <div className="stack">
        <div className="field">
          <label>{t('occasion')}</label>
          <div className="row wrap" style={{ gap: 8 }}>
            {OCCASIONS.map((o) => (
              <button key={o.id} className={`chip ${occasion === o.id ? 'active' : ''}`} onClick={() => setOccasion(o.id)}>
                <Icon name={o.icon} size={15} /> {t(o.id === 'other' ? 'otherOccasion' : o.id)}
              </button>
            ))}
          </div>
        </div>
        <div className="field"><label>{t('dateTime')}</label><input className="input" type="datetime-local" value={dateTime} onChange={(e) => setDateTime(e.target.value)} /></div>
        <div className="row-between"><span className="bold">{t('partySize')}</span><Stepper value={partySize} onChange={setPartySize} min={1} max={50} /></div>
        <div className="field"><label>{t('yourName')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>{t('phone')}</label><input className="input num" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="field"><label>{t('notes')}</label><textarea className="textarea" placeholder={lang === 'ar' ? 'أي تفاصيل خاصة (كيكة، تزيين، عدد...)' : 'Any special details (cake, decor, count...)'} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <p className="xs faint text-center">{lang === 'ar' ? 'سيتواصل معك الكافيه لتأكيد الحجز.' : 'The venue will contact you to confirm.'}</p>
      </div>
    </Sheet>
  )
}
