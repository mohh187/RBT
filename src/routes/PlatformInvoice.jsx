// /inv/:id — a platform tax invoice or credit note, as a printable sheet.
//
// Reads platformInvoices/{id} directly: firestore.rules already grants read to
// a platform admin OR the venue's own manager, so the venue can open its own
// invoice from a link in an email without any new rule or callable.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase.js'
import { Spinner, Empty } from '../components/ui.jsx'
import PlatformDocSheet from '../components/platform/PlatformDocSheet.jsx'

export default function PlatformInvoice() {
  const { id } = useParams()
  const [state, setState] = useState({ loading: true, doc: null, error: '' })

  useEffect(() => {
    let alive = true
    getDoc(doc(db, 'platformInvoices', id))
      .then((s) => {
        if (!alive) return
        if (!s.exists()) { setState({ loading: false, doc: null, error: 'notfound' }); return }
        const d = s.data()
        setState({
          loading: false,
          error: '',
          doc: {
            ...d,
            // Firestore Timestamps → plain millis for the sheet, which must not
            // know about Firestore at all.
            issuedAtMs: d.issuedAtMs || (d.issuedAt?.toMillis ? d.issuedAt.toMillis() : (d.createdAt?.toMillis ? d.createdAt.toMillis() : null)),
          },
        })
      })
      // A permission error and a missing document are the same thing to the
      // reader, and saying which would leak whether the id exists.
      .catch(() => { if (alive) setState({ loading: false, doc: null, error: 'notfound' }) })
    return () => { alive = false }
  }, [id])

  if (state.loading) return <div className="pdoc-page"><Spinner lg /></div>
  if (!state.doc) {
    return (
      <div className="pdoc-page">
        <Empty icon="receipt" title="المستند غير متاح" hint="تحقق من الرابط، أو اطلب نسخة جديدة من إدارة المنصة." />
      </div>
    )
  }
  return <PlatformDocSheet doc={state.doc} variant={state.doc.docType === 'creditNote' ? 'creditNote' : 'taxInvoice'} />
}
