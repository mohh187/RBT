import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { usePublicVenue } from '../../lib/usePublicVenue.js'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { FullSpinner, Empty, Stepper } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import DinerBar from '../../components/DinerBar.jsx'
import DinerNav from '../../components/DinerNav.jsx'
import { createReservation } from '../../lib/db.js'
import { getLocalCustomer, setLocalCustomer } from '../../lib/customer.js'
import { startPayment } from '../../lib/payments.js'

const OCCASIONS = [
  { id: 'birthday', icon: 'cake' },
  { id: 'gathering', icon: 'customers' },
  { id: 'meeting', icon: 'user' },
  { id: 'other', icon: 'star' },
]

export default function BookReservation() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const toast = useToast()
  const venue = usePublicVenue(slug)
  const local = getLocalCustomer()

  const [occasion, setOccasion] = useState('birthday')
  const [dateTime, setDateTime] = useState('')
  const [partySize, setPartySize] = useState(4)
  const [name, setName] = useState(local?.name || '')
  const [phone, setPhone] = useState(local?.phone || '')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  if (venue.loading) return <FullSpinner />
  if (venue.notFound || venue.error) return <div className="auth-shell"><Empty icon="search" title={venue.notFound ? (lang === 'ar' ? 'المنشأة غير موجودة' : 'Venue not found') : (lang === 'ar' ? 'تعذّر تحميل الصفحة، حدّث الصفحة' : 'Could not load — please refresh')} /></div>

  const deposit = Number(venue.tenant?.reservationDeposit) || 0
  const onlinePay = venue.tenant?.onlinePayment?.enabled === true
  const needsDeposit = deposit > 0 && onlinePay

  const submit = async () => {
    if (!name.trim() || !phone.trim()) { toast.error(lang === 'ar' ? 'الاسم والجوال مطلوبان' : 'Name and phone required'); return }
    if (!dateTime) { toast.error(lang === 'ar' ? 'اختر التاريخ والوقت' : 'Pick a date & time'); return }
    setBusy(true)
    try {
      const res = await createReservation(venue.tenantId, {
        occasion, dateTime: new Date(dateTime), partySize,
        name: name.trim(), phone: phone.trim(), notes: notes.trim(),
        ...(needsDeposit ? { depositAmount: deposit, depositStatus: 'pending' } : {}),
      })
      setLocalCustomer({ name: name.trim(), phone: phone.trim() })
      // Deposit + online payment → hosted checkout; the webhook confirms the booking.
      if (needsDeposit) {
        try { await startPayment('booking', venue.tenantId, res.id); return } catch (_) { toast.error(lang === 'ar' ? 'تعذّر فتح صفحة الدفع — طلبك محفوظ' : 'Could not open payment — request saved') }
      }
      navigate(`/pass/${slug}/reservation/${res.id}`)
    } catch (_) {
      toast.error(t('error'))
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100dvh', paddingBottom: 'calc(var(--bottomnav-h) + var(--safe-b) + 8px)' }}>
      <DinerBar tenant={venue.tenant} right={<Link to={`/m/${slug}`} className="icon-btn" title={t('menu')}><Icon name="menu" /></Link>} />
      <div className="container page stack">
        <h2 className="page-title row" style={{ gap: 8 }}><Icon name="cake" size={22} /> {t('bookOccasion')}</h2>

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

        <div className="row-between">
          <span className="bold">{t('partySize')}</span>
          <Stepper value={partySize} onChange={setPartySize} min={1} max={50} />
        </div>

        <div className="field"><label>{t('yourName')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>{t('phone')}</label><input className="input num" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="field"><label>{t('notes')}</label><textarea className="textarea" placeholder={lang === 'ar' ? 'أي تفاصيل خاصة (كيكة، تزيين، عدد...)' : 'Any special details (cake, decor, count...)'} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

        <button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={submit}>{busy ? t('saving') : needsDeposit ? (lang === 'ar' ? 'ادفع العربون وأكّد الحجز' : 'Pay deposit & confirm') : t('sendRequest')}</button>
        <p className="xs faint text-center">{needsDeposit ? (lang === 'ar' ? 'يتطلّب الحجز عربوناً، ويُؤكَّد فور الدفع.' : 'A deposit is required; the booking is confirmed on payment.') : (lang === 'ar' ? 'سيتواصل معك الكافيه لتأكيد الحجز.' : 'The venue will contact you to confirm.')}</p>
      </div>

      <DinerNav slug={slug} tenant={venue.tenant} active="reservations" />
    </div>
  )
}
