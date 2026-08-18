// /quote/:id/:token — the prospect's view of a quotation.
//
// Fetched through a CALLABLE, never a Firestore read: the quote carries the
// prospect's VAT number and a negotiated price, and an unguessable document id
// is not a permission model. The server compares the token in constant time
// and returns a redacted payload.
//
// Accepting issues a real tax invoice and hands the prospect to the EXISTING
// checkout — no new payment code anywhere in this flow.
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase.js'
import { Spinner, Empty } from '../components/ui.jsx'
import { useToast } from '../components/Toast.jsx'
import PlatformDocSheet from '../components/platform/PlatformDocSheet.jsx'

export default function PublicQuote() {
  const { id, token } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [state, setState] = useState({ loading: true, doc: null })
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    let alive = true
    httpsCallable(functions, 'getPublicQuote')({ id, token })
      .then((r) => { if (alive) setState({ loading: false, doc: r.data }) })
      .catch(() => { if (alive) setState({ loading: false, doc: null }) })
    return () => { alive = false }
  }, [id, token])

  const accept = async () => {
    setAccepting(true)
    try {
      const r = await httpsCallable(functions, 'acceptQuote')({ id, token })
      const invoiceId = r?.data?.invoiceId
      if (!invoiceId) throw new Error('no invoice')
      // The quote becomes a real invoice, then the ordinary subscription
      // checkout takes over — the same path a console-issued invoice uses.
      const { startPayment } = await import('../lib/payments.js')
      await startPayment('subscription', r.data.tenantId || state.doc?.tenantId, invoiceId)
    } catch (e) {
      const msg = e?.message || ''
      toast.error(/انتهت صلاحية/.test(msg) ? msg : (msg || 'تعذّر إتمام القبول، تواصل معنا'))
      setAccepting(false)
    }
  }

  if (state.loading) return <div className="pdoc-page"><Spinner lg /></div>
  if (!state.doc) {
    return (
      <div className="pdoc-page">
        <Empty icon="file" title="العرض غير متاح" hint="قد يكون الرابط غير صحيح أو انتهت صلاحيته. تواصل معنا لعرض محدّث." />
      </div>
    )
  }
  return <PlatformDocSheet doc={state.doc} variant="quote" onAccept={accept} accepting={accepting} />
}
