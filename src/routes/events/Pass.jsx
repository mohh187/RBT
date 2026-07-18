import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { resolveSlug, watchTicket, watchReservation } from '../../lib/db.js'
import { useI18n } from '../../lib/i18n.jsx'
import { FullSpinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import DinerBar from '../../components/DinerBar.jsx'
import { qrDataUrl, passUrl } from '../../lib/qr.js'
import { orderNumber } from '../../lib/format.js'
import { startPayment } from '../../lib/payments.js'

function fmtDate(ts, lang) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
  if (!d) return ''
  return d.toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', { dateStyle: 'full', timeStyle: 'short' })
}

const STATUS = {
  pending: { badge: 'badge-warning', icon: 'clock' },
  valid: { badge: 'badge-success', icon: 'ticket' },
  used: { badge: 'badge-info', icon: 'check' },
  requested: { badge: '', icon: 'clock' },
  confirmed: { badge: 'badge-success', icon: 'ok' },
  declined: { badge: 'badge-danger', icon: 'no' },
  done: { badge: 'badge-info', icon: 'check' },
  cancelled: { badge: 'badge-danger', icon: 'no' },
}

export default function Pass() {
  const { slug, kind, id } = useParams()
  const { t, lang } = useI18n()
  const [tid, setTid] = useState(null)
  const [doc, setDoc] = useState(undefined)
  const [qr, setQr] = useState('')
  const [paying, setPaying] = useState(false)
  const payNow = async () => { setPaying(true); try { await startPayment(kind === 'reservation' ? 'booking' : 'ticket', tid, id) } catch (_) { setPaying(false) } }

  useEffect(() => {
    let unsub
    resolveSlug(slug).then((resolved) => {
      setTid(resolved)
      if (!resolved) { setDoc(null); return }
      const watch = kind === 'ticket' ? watchTicket : watchReservation
      unsub = watch(resolved, id, setDoc)
    })
    return () => unsub && unsub()
  }, [slug, kind, id])

  useEffect(() => {
    if (doc?.qrToken) qrDataUrl(passUrl(slug, kind, id, doc.qrToken), { width: 600 }).then(setQr)
  }, [doc?.qrToken, slug, kind, id])

  if (doc === undefined) return <FullSpinner />
  if (!doc) return <div className="auth-shell"><Empty icon="search" title={t('invalidPass')} /></div>

  const isTicket = kind === 'ticket'
  const st = STATUS[doc.status] || STATUS.requested
  const statusLabel = {
    pending: lang === 'ar' ? 'بانتظار الدفع' : 'Awaiting payment',
    valid: t('valid'), used: t('used'), requested: t('requested'), confirmed: t('confirmed'),
    declined: t('declined'), done: t('checkedIn'), cancelled: t('statusCancelled'),
  }[doc.status] || doc.status
  const title = isTicket
    ? (lang === 'en' && doc.eventTitleEn ? doc.eventTitleEn : doc.eventTitleAr)
    : ({ birthday: t('birthday'), gathering: t('gathering'), meeting: t('meeting'), other: t('otherOccasion') }[doc.occasion] || t('reservationWord'))
  const dimmed = ['used', 'declined', 'cancelled'].includes(doc.status)

  return (
    <div style={{ minHeight: '100dvh' }}>
      <DinerBar tenant={{ name: t('digitalPass') }} right={<Link to={`/m/${slug}`} className="icon-btn"><Icon name="menu" /></Link>} />
      <div className="container page stack" style={{ alignItems: 'center', gap: 'var(--sp-4)' }}>
        <div className="card" style={{ width: '100%', maxWidth: 420, overflow: 'hidden', opacity: dimmed ? 0.7 : 1 }}>
          <div className="hero stack" style={{ borderRadius: 0, gap: 6, alignItems: 'center', textAlign: 'center' }}>
            <Icon name={isTicket ? 'ticket' : 'cake'} size={30} />
            <h2 style={{ fontSize: 'var(--fs-lg)', color: 'var(--on-brand)' }}>{title}</h2>
            <span className="badge" style={{ background: 'rgba(255,255,255,.2)', color: 'var(--on-brand)' }}>{orderNumber(doc.code)}</span>
          </div>

          <div className="card-pad stack" style={{ alignItems: 'center', gap: 'var(--sp-3)' }}>
            <span className={`badge ${st.badge}`} style={{ padding: '6px 14px' }}><Icon name={st.icon} size={15} /> {statusLabel}</span>

            {doc.status === 'pending' ? (
              <div className="stack center" style={{ gap: 10 }}>
                <p className="small muted text-center">{lang === 'ar' ? 'تذكرتك محفوظة وبانتظار إتمام الدفع.' : 'Your ticket is saved and awaiting payment.'}</p>
                <button className="btn btn-primary btn-lg" disabled={paying} onClick={payNow}><Icon name="wallet" size={18} /> {paying ? t('loading') : (lang === 'ar' ? 'ادفع الآن' : 'Pay now')}</button>
              </div>
            ) : (isTicket || doc.status === 'confirmed') ? (
              <>
                {qr ? <img src={qr} alt="QR" style={{ width: 220, height: 220 }} /> : <div className="spinner spinner-lg" />}
                <p className="xs faint text-center">{t('showAtEntry')}</p>
                {qr && (
                  <a className="btn btn-outline btn-sm" href={qr} download={`pass-${doc.code || id}.png`}>
                    <Icon name="download" size={15} /> {lang === 'ar' ? 'حفظ التذكرة (صورة)' : 'Save pass (image)'}
                  </a>
                )}
              </>
            ) : null}

            <div className="stack" style={{ gap: 4, width: '100%', borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)' }}>
              {isTicket ? (
                <>
                  {doc.startsAt && <Row icon="calendar" text={fmtDate(doc.startsAt, lang)} />}
                  {doc.typeName && <Row icon="ticket" text={doc.typeName} />}
                  <Row icon="user" text={doc.name || doc.phone} />
                </>
              ) : (
                <>
                  <Row icon="calendar" text={fmtDate(doc.dateTime, lang)} />
                  <Row icon="customers" text={`${doc.partySize} ${lang === 'ar' ? 'أشخاص' : 'guests'}`} />
                  <Row icon="user" text={doc.name || doc.phone} />
                  {doc.notes && <Row icon="edit" text={doc.notes} />}
                </>
              )}
            </div>

            {!isTicket && doc.depositStatus === 'pending' && doc.status !== 'confirmed' && (
              <div className="stack center" style={{ gap: 10 }}>
                <p className="small muted text-center">{lang === 'ar' ? 'هذا الحجز بانتظار دفع العربون لتأكيده.' : 'This booking awaits the deposit to be confirmed.'}</p>
                <button className="btn btn-primary btn-lg" disabled={paying} onClick={payNow}><Icon name="wallet" size={18} /> {paying ? t('loading') : (lang === 'ar' ? 'ادفع العربون' : 'Pay deposit')}</button>
              </div>
            )}
            {!isTicket && doc.status === 'requested' && doc.depositStatus !== 'pending' && (
              <p className="small muted text-center">{lang === 'ar' ? 'بانتظار تأكيد الكافيه — ستتحدث البطاقة تلقائياً.' : 'Awaiting confirmation — this updates automatically.'}</p>
            )}
            {!isTicket && doc.status === 'declined' && (
              <p className="small text-center" style={{ color: 'var(--danger)' }}>{lang === 'ar' ? 'عذراً، تعذّر تأكيد الحجز.' : 'Sorry, the booking could not be confirmed.'}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ icon, text }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <Icon name={icon} size={16} className="faint" />
      <span className="small">{text}</span>
    </div>
  )
}
