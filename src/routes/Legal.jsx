// Public legal pages — Terms, Privacy, Refund, Acceptable Use. Standalone
// (no app chrome), Arabic/RTL. Renders the published override (edited from the
// platform console) merged over the built-in defaults. Linked from menu/landing
// footers and required to be public for Moyasar merchant onboarding.
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useLocation } from 'react-router-dom'
import { LEGAL_DEFAULTS, LEGAL_ORDER, mergeLegal, loadPublishedLegal, COMPANY, isFilled, joinParts } from '../lib/legal.js'
import BrandMark from '../components/BrandMark.jsx'
import '../styles/platform-brand.css'

export default function Legal() {
  const { doc: docParam } = useParams()
  const loc = useLocation()
  const [published, setPublished] = useState(null)

  useEffect(() => { loadPublishedLegal().then(setPublished) }, [])

  const id = useMemo(() => {
    const fromPath = loc.pathname.replace(/^\//, '').split('/')[0]
    if (LEGAL_ORDER.includes(docParam)) return docParam
    if (LEGAL_ORDER.includes(fromPath)) return fromPath
    return 'terms'
  }, [docParam, loc.pathname])

  const docData = mergeLegal(published, id)

  return (
    // platform-scope: this public page is part of the RBT 360 identity — without
    // it the page fell back to the legacy maroon --brand and a plain text logo.
    <div className="platform-scope" dir="rtl" style={{ minHeight: '100dvh', background: 'var(--bg, #fafafa)', color: 'var(--text, #0a0a0b)' }}>
      <header style={{ borderBottom: '1px solid var(--border, #e7e7ea)', padding: '14px 16px', position: 'sticky', top: 0, background: 'var(--surface, #fff)', zIndex: 5 }}>
        <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link to="/" style={{ display: 'inline-flex', textDecoration: 'none', color: 'inherit' }} aria-label={COMPANY.brand}><BrandMark size={26} /></Link>
          <span style={{ color: 'var(--text-faint, #9a9aa5)', fontSize: 13 }}>· المستندات القانونية</span>
        </div>
      </header>

      <div style={{ maxWidth: 780, margin: '0 auto', padding: '16px' }}>
        {/* doc tabs */}
        <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {LEGAL_ORDER.map((d) => (
            <Link
              key={d}
              to={`/legal/${d}`}
              style={{
                padding: '7px 14px', borderRadius: 999, textDecoration: 'none', fontSize: 14, fontWeight: 700,
                border: '1px solid var(--border, #e7e7ea)',
                background: d === id ? 'var(--brand, #7c2d2d)' : 'transparent',
                color: d === id ? '#fff' : 'var(--text-muted, #5c5c66)',
              }}
            >
              {LEGAL_DEFAULTS[d].title}
            </Link>
          ))}
        </nav>

        <article>
          <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 6 }}>{docData.title}</h1>
          <p style={{ color: 'var(--text-faint, #9a9aa5)', fontSize: 13, marginBottom: 16 }}>
            الإصدار {docData.version} · آخر تحديث {docData.updated}
          </p>
          {docData.intro && (
            <p style={{ fontSize: 15, lineHeight: 1.9, marginBottom: 20, color: 'var(--text-muted, #5c5c66)' }}>{docData.intro}</p>
          )}
          {(docData.sections || []).map((s, i) => (
            <section key={i} style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 17, fontWeight: 800, marginBottom: 8 }}>{s.h}</h2>
              <p style={{ fontSize: 15, lineHeight: 1.9, color: 'var(--text-muted, #5c5c66)', whiteSpace: 'pre-wrap' }}>{s.body}</p>
            </section>
          ))}
        </article>

        <footer style={{ borderTop: '1px solid var(--border, #e7e7ea)', marginTop: 24, paddingTop: 16, fontSize: 13, color: 'var(--text-faint, #9a9aa5)' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
            {LEGAL_ORDER.map((d) => <Link key={d} to={`/legal/${d}`} style={{ color: 'inherit' }}>{LEGAL_DEFAULTS[d].title}</Link>)}
            <Link to="/status" style={{ color: 'inherit' }}>حالة المنصة</Link>
          </div>
          {/* Only real values print. Unfilled fields are still «[…]» template
              tokens — showing those on a binding public document would look
              broken to a customer, a regulator or a payment processor. */}
          <p>{joinParts([COMPANY.legalName, COMPANY.email, COMPANY.phone], ' · ')}</p>
          {(isFilled(COMPANY.cr) || isFilled(COMPANY.vat)) && (
            <p style={{ marginTop: 4 }}>
              {joinParts([
                isFilled(COMPANY.cr) ? `سجل تجاري: ${COMPANY.cr}` : '',
                isFilled(COMPANY.vat) ? `الرقم الضريبي: ${COMPANY.vat}` : '',
              ], ' · ')}
            </p>
          )}
        </footer>
      </div>
    </div>
  )
}
