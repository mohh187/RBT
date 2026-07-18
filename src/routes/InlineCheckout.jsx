import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase.js'
import { useI18n } from '../lib/i18n.jsx'
import Icon from '../components/Icon.jsx'
import { FullSpinner } from '../components/ui.jsx'
import { Price } from '../components/Riyal.jsx'
import { deviceKey } from '../lib/device.js'
import { listSavedCards, payWithSavedCard } from '../lib/payments.js'

// Inline checkout on OUR OWN domain. Renders Moyasar's embedded form so that
// Apple Pay opens its NATIVE sheet in place (no jump to checkout.moyasar.com),
// with card + STC Pay as inline fallbacks. The amount is read from the server-
// derived payIntent doc; integrity is still enforced at settle time (the server
// binds payment.amount to payIntent.amount before fulfilling).
const MOYASAR_VER = '1.15.0'
const SDK_CSS = `https://cdn.moyasar.com/mpf/${MOYASAR_VER}/moyasar.css`
const SDK_JS = `https://cdn.moyasar.com/mpf/${MOYASAR_VER}/moyasar.js`

function loadMoyasar() {
  if (window.Moyasar) return Promise.resolve(window.Moyasar)
  return new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${SDK_CSS}"]`)) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = SDK_CSS; document.head.appendChild(css)
    }
    let s = document.querySelector(`script[src="${SDK_JS}"]`)
    if (s && window.Moyasar) { resolve(window.Moyasar); return }
    if (!s) { s = document.createElement('script'); s.src = SDK_JS; document.head.appendChild(s) }
    s.addEventListener('load', () => resolve(window.Moyasar))
    s.addEventListener('error', reject)
    if (window.Moyasar) resolve(window.Moyasar)
  })
}

export default function InlineCheckout() {
  const { intentId } = useParams()
  const nav = useNavigate()
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const [state, setState] = useState('loading') // loading | ready | error
  const [intent, setIntent] = useState(null)
  const [venueName, setVenueName] = useState('')
  const [cards, setCards] = useState([]) // this device's saved cards (last4/brand only)
  const [charging, setCharging] = useState('') // savedCardId currently being charged
  const [cardError, setCardError] = useState('')
  const inited = useRef(false)
  const hostedUrl = (() => { try { return sessionStorage.getItem(`payHosted:${intentId}`) || '' } catch { return '' } })()

  // 1) Load the server-derived intent (amount, kind, refs).
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const snap = await getDoc(doc(db, 'payIntents', intentId))
        if (!alive) return
        if (!snap.exists()) { setState('error'); return }
        const d = { id: snap.id, ...snap.data() }
        if (d.status === 'paid') { nav(`/pay/return?intent=${intentId}`, { replace: true }); return }
        setIntent(d)
        if (d.tenantId) {
          const t = await getDoc(doc(db, 'tenants', d.tenantId)).catch(() => null)
          if (alive && t?.exists()) setVenueName(t.data()?.name || t.data()?.nameAr || '')
          if (d.kind !== 'subscription') {
            const saved = await listSavedCards(d.tenantId)
            if (alive) setCards(saved)
          }
        }
      } catch { if (alive) setState('error') }
    })()
    return () => { alive = false }
  }, [intentId, nav])

  // 2) Mount the Moyasar embedded form once the intent + DOM are ready.
  useEffect(() => {
    if (!intent || inited.current) return
    const key = import.meta.env.VITE_MOYASAR_PUBLISHABLE_KEY
    const amount = Number(intent.amount) || 0 // halalas (server-derived)
    if (!key || amount < 1) {
      // Can't init the inline form — fall back to the hosted page so payment never breaks.
      if (hostedUrl) { window.location.href = hostedUrl; return }
      setState('error'); return
    }
    inited.current = true
    let cancelled = false
    loadMoyasar()
      .then((Moyasar) => {
        if (cancelled || !Moyasar) throw new Error('sdk')
        Moyasar.init({
          element: '.mysr-form',
          amount,
          currency: intent.currency || 'SAR',
          description: intent.description || venueName || 'Payment',
          publishable_api_key: key,
          callback_url: `${window.location.origin}/pay/return?intent=${intentId}`,
          supported_networks: ['visa', 'mastercard', 'mada', 'amex'],
          methods: ['applepay', 'creditcard', 'stcpay'],
          // Offer to save the card (Moyasar shows its own checkbox); on success the
          // token is captured server-side and stored against this device only.
          save_card: intent.kind !== 'subscription',
          apple_pay: {
            country: 'SA',
            label: venueName || 'rbt360',
            validate_merchant_url: 'https://api.moyasar.com/v1/applepay/initiate',
          },
          metadata: { payIntentId: intentId, kind: intent.kind || '', tenantId: intent.tenantId || '', refId: intent.refId || '', deviceKey: deviceKey() },
        })
        setState('ready')
      })
      .catch(() => {
        if (hostedUrl) { window.location.href = hostedUrl; return }
        setState('error')
      })
    return () => { cancelled = true }
  }, [intent, venueName, intentId, hostedUrl])

  if (state === 'error') {
    return (
      <div className="auth-shell">
        <div className="card card-pad stack center" style={{ maxWidth: 400, gap: 14, textAlign: 'center' }}>
          <span className="center" style={{ width: 60, height: 60, borderRadius: '50%', background: 'var(--danger-soft)', color: 'var(--danger)' }}><Icon name="no" size={30} /></span>
          <strong style={{ fontSize: 'var(--fs-lg)' }}>{ar ? 'تعذّر فتح الدفع' : 'Could not open payment'}</strong>
          <p className="muted small">{ar ? 'لم تُخصم أي مبالغ. يمكنك المحاولة مرة أخرى.' : 'No charge was made. Please try again.'}</p>
          {hostedUrl && <a href={hostedUrl} className="btn btn-primary btn-block">{ar ? 'المتابعة لصفحة الدفع' : 'Continue to payment'}</a>}
          <button className="btn btn-ghost btn-block" onClick={() => nav(-1)}>{ar ? 'رجوع' : 'Back'}</button>
        </div>
      </div>
    )
  }

  // One-tap charge on a saved card. Server verifies the device + re-derives the
  // amount; 3DS-required cards get a transaction URL to finish, then /pay/return settles.
  const paySaved = async (cardId) => {
    if (charging || !intent) return
    setCharging(cardId); setCardError('')
    try {
      const r = await payWithSavedCard({ tenantId: intent.tenantId, kind: intent.kind, refId: intent.refId, savedCardId: cardId })
      if (r.paid) { nav(`/pay/return?intent=${r.payIntentId || intentId}${r.paymentId ? `&id=${r.paymentId}&status=paid` : ''}`, { replace: true }); return }
      if (r.transactionUrl) { window.location.href = r.transactionUrl; return }
      setCharging(''); setCardError(ar ? 'تعذّر الدفع بهذه البطاقة، جرّب أخرى.' : 'This card was declined, try another.')
    } catch (_) { setCharging(''); setCardError(ar ? 'تعذّر الدفع بالبطاقة المحفوظة.' : 'Saved-card payment failed.') }
  }

  const brandLabel = (b) => ({ mada: 'مدى', visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex' }[b] || (b || 'Card'))
  const sar = intent ? (Number(intent.amount) || 0) / 100 : 0
  return (
    <div className="auth-shell">
      <div className="card card-pad stack" style={{ maxWidth: 460, width: '100%', gap: 16 }}>
        <div className="stack center" style={{ gap: 4, textAlign: 'center' }}>
          {venueName && <span className="muted small">{venueName}</span>}
          <strong style={{ fontSize: 'clamp(28px, 6vw, 40px)', fontWeight: 800, lineHeight: 1.15 }}>
            <Price value={sar} currency={intent?.currency || 'SAR'} lang={lang} />
          </strong>
          {intent?.description && <span className="muted small">{intent.description}</span>}
        </div>

        {/* #6 saved cards — one tap to pay with a card kept on this device */}
        {cards.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="xs faint">{ar ? 'بطاقاتك المحفوظة على هذا الجهاز' : 'Your saved cards on this device'}</span>
            {cards.map((c) => (
              <button key={c.id} className="btn btn-outline btn-block" disabled={!!charging} onClick={() => paySaved(c.id)}
                style={{ justifyContent: 'space-between', gap: 8 }}>
                <span className="row" style={{ gap: 8 }}><Icon name="card" size={16} /> {brandLabel(c.brand)} ···· {c.last4}</span>
                <span className="bold">{charging === c.id ? (ar ? 'جارٍ الدفع…' : 'Paying…') : (ar ? 'ادفع' : 'Pay')}</span>
              </button>
            ))}
            {cardError && <span className="xs" style={{ color: 'var(--danger)' }}>{cardError}</span>}
            <div className="row center" style={{ gap: 8, color: 'var(--text-muted)' }}>
              <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span className="xs">{ar ? 'أو بطاقة جديدة' : 'or a new card'}</span>
              <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
          </div>
        )}

        {state === 'loading' && <FullSpinner />}
        {/* Moyasar renders Apple Pay (native, in-place) + card + STC Pay here. */}
        <div className="mysr-form" style={{ display: state === 'ready' ? 'block' : 'none' }} />

        <div className="row center" style={{ gap: 6, color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
          <Icon name="lock" size={13} />
          <span>{ar ? 'دفع آمن — تُعالَج بياناتك عبر ميسر' : 'Secure payment — processed by Moyasar'}</span>
        </div>
        {hostedUrl && (
          <button className="btn btn-ghost btn-sm btn-block" onClick={() => { window.location.href = hostedUrl }}>
            {ar ? 'الدفع بطريقة أخرى' : 'Pay another way'}
          </button>
        )}
      </div>
    </div>
  )
}
