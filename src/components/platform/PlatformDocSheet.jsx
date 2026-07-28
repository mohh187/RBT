// The printable A4 document: tax invoice, credit note, or quotation.
//
// ONE COMPONENT, THREE VARIANTS, because they are the same sheet with
// different words — and keeping them together is what stops a change to the
// invoice layout from quietly leaving the quotation behind.
//
// WHY BROWSER PRINT AND NOT A PDF LIBRARY. jsPDF and pdfmake do no Arabic
// shaping and no bidi: letters come out disconnected and reversed unless you
// pre-shape and reorder by hand, and ligature quality stays poor. pdf-lib has
// no text layout engine at all. The only thing that renders Arabic correctly
// is the browser's own text engine — which is already proving it twice in this
// codebase (src/routes/Invoice.jsx and body.acc-printing in Accounting.jsx).
// A print stylesheet costs nothing, weighs nothing, and is right by
// construction. The honest limitation is that you cannot attach the result to
// an email; you send a LINK, which is better anyway because the recipient
// always sees the current status rather than a stale file.
import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { qrDataUrl } from '../../lib/qr.js'

// Latin digits with thousands separators — Arabic-Indic numerals are a hard
// project rule against, and `ar-SA-u-nu-latn` is the sanctioned locale.
const n2 = (v) => (Number(v) || 0).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dateAr = (ms) => (ms ? new Date(ms).toLocaleDateString('ar-SA-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' }) : '')

const TITLE = {
  taxInvoice: 'فاتورة ضريبية',
  creditNote: 'إشعار دائن',
  quote: 'عرض سعر',
}
const TITLE_EN = {
  taxInvoice: 'Tax Invoice',
  creditNote: 'Credit Note',
  quote: 'Quotation',
}

export default function PlatformDocSheet({ doc, variant = 'taxInvoice', onAccept, accepting }) {
  const [qr, setQr] = useState('')
  useEffect(() => {
    let alive = true
    const payload = doc?.zatca?.qr
    if (!payload) { setQr(''); return undefined }
    qrDataUrl(payload, { size: 132 }).then((u) => { if (alive) setQr(u) }).catch(() => {})
    return () => { alive = false }
  }, [doc?.zatca?.qr])

  if (!doc) return null
  const s = doc.seller || {}
  const b = doc.buyer || {}
  const isQuote = variant === 'quote'
  const expired = isQuote && doc.validUntil && Date.now() > Number(doc.validUntil)
  const promo = doc.promo || null

  return (
    <div className="pdoc-page">
      <div className="pdoc" dir="rtl">
        {/* ---------- letterhead ---------- */}
        <header className="pdoc-head">
          <div className="pdoc-brand">
            <img src={s.logoUrl || '/brand/word-448.png'} alt={s.brand || 'RBT360'} className="pdoc-logo" />
            <div className="pdoc-seller">
              <strong>{s.legalNameAr}</strong>
              <span>{s.legalNameEn}</span>
              <span>{s.addressAr}</span>
              <span dir="ltr" className="pdoc-ltr">
                {[s.contactEmail, s.contactPhone, s.website].filter(Boolean).join('  ·  ')}
              </span>
            </div>
          </div>
          <div className="pdoc-meta">
            <div className="pdoc-title">{TITLE[variant] || TITLE.taxInvoice}</div>
            <div className="pdoc-title-en">{TITLE_EN[variant] || ''}</div>
            <div className="pdoc-no" dir="ltr">{doc.no}</div>
            <dl className="pdoc-kv">
              <dt>التاريخ</dt><dd>{dateAr(doc.issuedAtMs)}</dd>
              {isQuote
                ? <><dt>ساري حتى</dt><dd className={expired ? 'pdoc-danger' : ''}>{dateAr(doc.validUntil)}</dd></>
                : <><dt>الاستحقاق</dt><dd>{dateAr(doc.dueAt)}</dd></>}
              <dt>الرقم الضريبي</dt><dd dir="ltr" className="pdoc-ltr">{s.vatNumber}</dd>
              <dt>السجل التجاري</dt><dd dir="ltr" className="pdoc-ltr">{s.crNumber}</dd>
            </dl>
          </div>
        </header>

        {/* ---------- buyer ---------- */}
        <section className="pdoc-buyer">
          <div>
            <span className="pdoc-label">{isQuote ? 'مقدَّم إلى' : 'فاتورة إلى'}</span>
            <strong>{b.nameAr || doc.tenantName || '—'}</strong>
            {b.contactName ? <span>{b.contactName}</span> : null}
            {b.cityAr ? <span>{b.cityAr}</span> : null}
          </div>
          <div className="pdoc-buyer-ids">
            {b.vatNumber ? <span>الرقم الضريبي: <span dir="ltr" className="pdoc-ltr">{b.vatNumber}</span></span> : null}
            {b.crNumber ? <span>السجل التجاري: <span dir="ltr" className="pdoc-ltr">{b.crNumber}</span></span> : null}
            {b.email ? <span dir="ltr" className="pdoc-ltr">{b.email}</span> : null}
            {b.phone ? <span dir="ltr" className="pdoc-ltr">{b.phone}</span> : null}
          </div>
        </section>

        {/* ---------- what is included (quotes only) ---------- */}
        {isQuote && (doc.features || []).length > 0 && (
          <section className="pdoc-features">
            <span className="pdoc-label">ما تشمله الباقة</span>
            <ul>
              {doc.features.map((f, i) => (
                <li key={i}><Icon name="check" size={13} /> {f}</li>
              ))}
            </ul>
          </section>
        )}

        {/* ---------- lines ---------- */}
        <table className="pdoc-table">
          <thead>
            <tr>
              <th>البيان</th>
              <th className="pdoc-c">الكمية</th>
              <th className="pdoc-c">السعر</th>
              <th className="pdoc-c">الإجمالي قبل الضريبة</th>
            </tr>
          </thead>
          <tbody>
            {(doc.lines || []).map((l, i) => (
              <tr key={i}>
                <td>
                  {l.descAr}
                  {l.discount > 0 && l.discountLabelAr
                    ? <div className="pdoc-disc">{l.discountLabelAr} — وفّرت <span className="pdoc-num">{n2(l.discount)}</span> ريال</div>
                    : null}
                </td>
                <td className="pdoc-c pdoc-num">{l.qty}</td>
                <td className="pdoc-c">
                  {/* The struck-through original beside what is actually charged.
                      Shown ONLY when a real discount exists — a fake «before»
                      price is the kind of thing a customer notices. */}
                  {l.discount > 0
                    ? <><s className="pdoc-was pdoc-num">{n2(l.listPrice)}</s> <span className="pdoc-num">{n2(l.unitPrice)}</span></>
                    : <span className="pdoc-num">{n2(l.unitPrice)}</span>}
                </td>
                <td className="pdoc-c pdoc-num">{n2(l.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ---------- totals ---------- */}
        <section className="pdoc-totals">
          <div className="pdoc-qr">
            {qr ? (
              <>
                <img src={qr} alt="ZATCA QR" />
                <span className="pdoc-qr-cap">رمز الفاتورة الضريبية</span>
              </>
            ) : null}
          </div>
          <dl className="pdoc-sum">
            <dt>الإجمالي قبل الضريبة</dt><dd className="pdoc-num">{n2(doc.subtotal)}</dd>
            {doc.discountTotal > 0 && (
              <>
                <dt className="pdoc-save">{promo ? promo.labelAr : 'الخصم'}</dt>
                <dd className="pdoc-save pdoc-num">−{n2(doc.discountTotal)}</dd>
              </>
            )}
            <dt>ضريبة القيمة المضافة <span className="pdoc-num">({doc.vatRate}%)</span></dt><dd className="pdoc-num">{n2(doc.vat)}</dd>
            <dt className="pdoc-grand">الإجمالي شامل الضريبة</dt>
            <dd className="pdoc-grand pdoc-num">{n2(doc.total)} <span className="pdoc-cur">ريال</span></dd>
          </dl>
        </section>

        {/* ---------- bank ---------- */}
        {s.showIban && s.iban && doc.status !== 'paid' && (
          <section className="pdoc-bank">
            <span className="pdoc-label">بيانات التحويل</span>
            <div className="pdoc-bank-row">
              <span>{s.bankNameAr}</span>
              <span dir="ltr" className="pdoc-ltr pdoc-iban">{String(s.iban).replace(/(.{4})/g, '$1 ').trim()}</span>
              <span dir="ltr" className="pdoc-ltr">{s.swift}</span>
            </div>
          </section>
        )}

        {/* ---------- terms ---------- */}
        {(doc.termsAr || []).length > 0 && (
          <section className="pdoc-terms">
            <span className="pdoc-label">الشروط</span>
            <ol>{doc.termsAr.map((t, i) => <li key={i}>{t}</li>)}</ol>
          </section>
        )}
        {doc.notesAr ? <section className="pdoc-notes">{doc.notesAr}</section> : null}

        <footer className="pdoc-foot">
          <span>{s.legalNameAr} · س.ت <span dir="ltr" className="pdoc-ltr">{s.crNumber}</span> · الرقم الضريبي <span dir="ltr" className="pdoc-ltr">{s.vatNumber}</span></span>
          {s.footerNoteAr ? <span>{s.footerNoteAr}</span> : null}
        </footer>
      </div>

      {/* ---------- actions (never printed) ---------- */}
      <div className="pdoc-actions no-print">
        <button className="btn btn-outline" onClick={() => window.print()}>
          <Icon name="print" size={16} /> طباعة أو حفظ PDF
        </button>
        {isQuote && onAccept && !expired && doc.status !== 'accepted' && (
          <button className="btn btn-primary" disabled={accepting} onClick={onAccept}>
            <Icon name="check" size={16} /> {accepting ? 'جارٍ…' : 'قبول العرض والمتابعة للدفع'}
          </button>
        )}
        {expired ? <span className="pdoc-danger">انتهت صلاحية هذا العرض — تواصل معنا لعرض محدّث.</span> : null}
      </div>
    </div>
  )
}
