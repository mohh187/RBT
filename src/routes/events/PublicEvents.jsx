import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { usePublicVenue } from '../../lib/usePublicVenue.js'
import { useI18n, pickLang } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { FullSpinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import DinerBar from '../../components/DinerBar.jsx'
import DinerNav from '../../components/DinerNav.jsx'
import Sheet from '../../components/Sheet.jsx'
import { watchEvents, createTicket } from '../../lib/db.js'
import { Price } from '../../components/Riyal.jsx'
import { getLocalCustomer, setLocalCustomer, addMyPass, getMyPasses } from '../../lib/customer.js'
import { startPayment, issueFreeTicket } from '../../lib/payments.js'

function fmtDate(ts, lang) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
  if (!d) return ''
  return d.toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', { dateStyle: 'full', timeStyle: 'short' })
}

export default function PublicEvents() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const venue = usePublicVenue(slug)
  const [events, setEvents] = useState(null)
  const [active, setActive] = useState(null)
  const [passesOpen, setPassesOpen] = useState(false)

  useEffect(() => {
    if (!venue.tenantId) return
    return watchEvents(venue.tenantId, setEvents)
  }, [venue.tenantId])

  const published = useMemo(() => (events || []).filter((e) => e.status === 'published'), [events])
  const myPasses = useMemo(() => (venue.tenantId ? getMyPasses(venue.tenantId) : []), [venue.tenantId])

  if (venue.loading) return <FullSpinner />
  if (venue.notFound || venue.error) return <div className="auth-shell"><Empty icon="search" title={venue.notFound ? (lang === 'ar' ? 'المنشأة غير موجودة' : 'Venue not found') : (lang === 'ar' ? 'تعذّر تحميل الصفحة، حدّث الصفحة' : 'Could not load — please refresh')} /></div>
  if (venue.tenantId && events === null) return <FullSpinner />

  return (
    <div style={{ minHeight: '100dvh', paddingBottom: 'calc(var(--bottomnav-h) + var(--safe-b) + 8px)' }}>
      <DinerBar tenant={venue.tenant} right={<Link to={`/m/${slug}`} className="icon-btn" title={t('menu')}><Icon name="menu" /></Link>} />
      <div className="container page stack">
        <div className="row-between">
          <h2 className="page-title row" style={{ gap: 8 }}><Icon name="events" size={22} /> {t('events')}</h2>
          {myPasses.length > 0 && (
            <button className="btn btn-outline btn-sm" onClick={() => setPassesOpen(true)}>
              <Icon name="ticket" size={15} /> {lang === 'ar' ? `تذاكري (${myPasses.length})` : `My tickets (${myPasses.length})`}
            </button>
          )}
        </div>
        {published.length === 0 ? (
          <Empty icon="events" title={t('noEvents')} />
        ) : (
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            {published.map((e) => (
              <button key={e.id} className="card" onClick={() => setActive(e)} style={{ overflow: 'hidden', textAlign: 'start' }}>
                {e.imageUrl && <img src={e.imageUrl} alt="" style={{ width: '100%', height: 150, objectFit: 'cover' }} />}
                <div className="card-pad stack" style={{ gap: 6 }}>
                  <strong style={{ fontSize: 'var(--fs-md)' }}>{pickLang(e, 'title', lang)}</strong>
                  <span className="small muted"><Icon name="calendar" size={14} /> {fmtDate(e.startsAt, lang)}</span>
                  {e.location && <span className="xs faint" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><Icon name="pin" size={13} /> {e.location}</span>}
                  <span className="badge" style={{ width: 'fit-content' }}>{t('getTicket')}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {active && (
        <BookTicketSheet
          event={active} tenantId={venue.tenantId} currency={venue.tenant?.currency || 'SAR'}
          onlinePay={venue.tenant?.onlinePayment?.enabled === true}
          onClose={() => setActive(null)}
          onBooked={(id) => navigate(`/pass/${slug}/ticket/${id}`)}
        />
      )}

      <Sheet open={passesOpen} onClose={() => setPassesOpen(false)} title={lang === 'ar' ? 'تذاكري' : 'My tickets'}>
        {myPasses.length === 0 ? (
          <Empty icon="ticket" title={lang === 'ar' ? 'لا تذاكر محفوظة' : 'No saved tickets'} />
        ) : (
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {myPasses.map((p) => (
              <button key={p.id} className="list-row" onClick={() => { setPassesOpen(false); navigate(`/pass/${slug}/${p.kind || 'ticket'}/${p.id}`) }}>
                <span className="center" style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)', flex: 'none' }}><Icon name="ticket" size={16} /></span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title || (lang === 'ar' ? 'تذكرة' : 'Ticket')}</div>
                  <div className="xs faint">{p.code}</div>
                </div>
                <Icon name={lang === 'ar' ? 'back' : 'next'} size={16} className="faint" />
              </button>
            ))}
          </div>
        )}
      </Sheet>

      <DinerNav slug={slug} tenant={venue.tenant} active="events" />
    </div>
  )
}

function BookTicketSheet({ event, tenantId, currency, onlinePay, onClose, onBooked }) {
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
    const price = Number(type.price) || 0
    try {
      if (price <= 0) {
        // FREE ticket — issued server-side (re-verifies the event type price is 0);
        // a diner can no longer self-issue a 'valid' ticket for a paid event.
        const res = await issueFreeTicket({ tenantId, eventId: event.id, typeKey: type.key, name: name.trim(), phone: phone.trim() })
        addMyPass(tenantId, { id: res.id, code: res.code, kind: 'ticket', title: pickLang(event, 'title', lang) })
        setLocalCustomer({ name: name.trim(), phone: phone.trim() })
        onBooked(res.id)
        return
      }
      // PRICED ticket — requires online payment; created 'pending', the webhook
      // flips it to 'valid' after payment.
      if (!onlinePay) { toast.error(lang === 'ar' ? 'الدفع الإلكتروني غير مفعّل لهذه الفعالية' : 'Online payment is not enabled for this event'); setBusy(false); return }
      const res = await createTicket(tenantId, {
        eventId: event.id,
        eventTitleAr: event.titleAr || '', eventTitleEn: event.titleEn || '',
        startsAt: event.startsAt || null,
        typeKey: type.key, typeName: pickLang(type, 'name', lang), price,
        name: name.trim(), phone: phone.trim(),
      }, { pending: true })
      addMyPass(tenantId, { id: res.id, code: res.code, kind: 'ticket', title: pickLang(event, 'title', lang) })
      setLocalCustomer({ name: name.trim(), phone: phone.trim() })
      try { await startPayment('ticket', tenantId, res.id); return } catch (_) { toast.error(lang === 'ar' ? 'تعذّر فتح صفحة الدفع — تذكرتك محفوظة' : 'Could not open payment — your ticket is saved'); setBusy(false) }
    } catch (_) {
      toast.error(t('error'))
      setBusy(false)
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
