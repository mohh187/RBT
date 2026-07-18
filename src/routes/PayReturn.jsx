import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase.js'
import { useI18n } from '../lib/i18n.jsx'
import Icon from '../components/Icon.jsx'
import { FullSpinner } from '../components/ui.jsx'
import { confirmPayment } from '../lib/payments.js'

// Moyasar redirects here after a hosted checkout (success_url). We confirm the
// payment server-side (idempotent with the webhook) and show the result.
export default function PayReturn() {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const [params] = useSearchParams()
  const [state, setState] = useState('checking') // checking | paid | pending | failed
  const [orderLink, setOrderLink] = useState('') // "view my order" — never strand the guest
  const intent = params.get('intent')
  const paymentId = params.get('id') // Moyasar appends the payment id + status
  const moyStatus = params.get('status')

  const [rechecking, setRechecking] = useState(false)

  useEffect(() => {
    let alive = true
    let timer
    let tries = 0
    const run = async () => {
      if (moyStatus && moyStatus !== 'paid') { if (alive) setState('failed'); return }
      try {
        const r = await confirmPayment({ payIntentId: intent, paymentId })
        if (!alive) return
        if (r.settled) { setState('paid'); return }
        setState('pending')
      } catch { if (alive) setState('pending') }
      // The webhook may settle a moment later — keep re-confirming for a while
      // so the guest is not stranded on "Confirming…" forever.
      if (alive && tries < 6) { tries += 1; timer = setTimeout(run, 4000) }
    }
    run()
    return () => { alive = false; clearTimeout(timer) }
  }, [intent, paymentId, moyStatus])

  // Manual re-check for the pending state (after auto-retries run out).
  const recheck = async () => {
    if (rechecking) return
    setRechecking(true)
    try {
      const r = await confirmPayment({ payIntentId: intent, paymentId })
      setState(r.settled ? 'paid' : 'pending')
    } catch (_) { /* stay pending */ }
    finally { setRechecking(false) }
  }

  // For ORDER payments, resolve the venue slug so the guest lands back on their
  // order tracking page instead of a dead-end "back home".
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!intent) return
      try {
        const snap = await getDoc(doc(db, 'payIntents', intent))
        if (!alive || !snap.exists()) return
        const d = snap.data() || {}
        if (d.kind !== 'order' || !d.tenantId || !d.refId) return
        const t = await getDoc(doc(db, 'tenants', d.tenantId))
        const slug = t.exists() ? t.data()?.slug : ''
        if (alive && slug) setOrderLink(`/order/${slug}/${d.refId}`)
      } catch (_) { /* keep the generic home link */ }
    })()
    return () => { alive = false }
  }, [intent])

  if (state === 'checking') return <FullSpinner />
  const ok = state === 'paid'
  const pending = state === 'pending'
  return (
    <div className="auth-shell">
      <div className="card card-pad stack center" style={{ maxWidth: 400, gap: 16, textAlign: 'center' }}>
        <span className="center" style={{ width: 66, height: 66, borderRadius: '50%', background: ok ? 'var(--success-soft)' : pending ? 'var(--surface-2)' : 'var(--danger-soft)', color: ok ? 'var(--success)' : pending ? 'var(--text-muted)' : 'var(--danger)' }}>
          <Icon name={ok ? 'ok' : pending ? 'clock' : 'no'} size={34} />
        </span>
        <strong style={{ fontSize: 'var(--fs-lg)' }}>
          {ok ? (ar ? 'تم الدفع بنجاح' : 'Payment successful') : pending ? (ar ? 'قيد التأكيد' : 'Confirming…') : (ar ? 'لم يكتمل الدفع' : 'Payment not completed')}
        </strong>
        <p className="muted small">
          {ok ? (ar ? 'شكراً لك، تم استلام دفعتك.' : 'Thank you — your payment was received.')
            : pending ? (ar ? 'سنؤكّد دفعتك خلال لحظات؛ يمكنك متابعة طلبك.' : 'We will confirm your payment shortly; you can track your order.')
              : (ar ? 'لم تُخصم أي مبالغ. يمكنك المحاولة مرة أخرى.' : 'No charge was made. You can try again.')}
        </p>
        {pending && (
          <button className="btn btn-outline btn-block" disabled={rechecking} onClick={recheck}>
            <Icon name="reload" size={16} /> {rechecking ? (ar ? 'جارٍ التحقّق…' : 'Checking…') : (ar ? 'تحقّق مجدداً' : 'Check again')}
          </button>
        )}
        {/* failed → retry the SAME payment; order → back to tracking, never a dead-end */}
        {!ok && !pending && intent && (
          <Link to={`/pay/${intent}`} className="btn btn-primary btn-block"><Icon name="wallet" size={16} /> {ar ? 'إعادة محاولة الدفع' : 'Retry payment'}</Link>
        )}
        {orderLink && (
          <Link to={orderLink} className={`btn btn-block ${ok || pending ? 'btn-primary' : 'btn-outline'}`}><Icon name="receipt" size={16} /> {ar ? 'عرض طلبي' : 'View my order'}</Link>
        )}
        {!orderLink && (ok || pending) && <Link to="/" className="btn btn-primary btn-block">{ar ? 'العودة للرئيسية' : 'Back home'}</Link>}
        {(orderLink || (!ok && !pending)) && <Link to="/" className="btn btn-ghost btn-block" style={{ color: 'var(--text-muted)' }}>{ar ? 'الرئيسية' : 'Home'}</Link>}
      </div>
    </div>
  )
}
