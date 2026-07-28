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
    // THE ZATCA QR IS FOR TAX INVOICES ONLY — never a quotation.
    // It encodes seller, VAT number, timestamp and the VAT actually charged;
    // printing it on a document that is not a tax invoice would put a
    // regulator's marker on a non-taxable offer and invite exactly the
    // confusion it exists to prevent. Quotations therefore carry no QR at all.
    const payload = variant === 'quote' ? '' : (doc?.zatca?.qr || '')
    if (!payload) { setQr(''); return undefined }
    qrDataUrl(payload, { size: 132 }).then((u) => { if (alive) setQr(u) }).catch(() => {})
    return () => { alive = false }
  }, [doc?.zatca?.qr, variant])

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
        {/* Logo ABOVE the company details, not beside them: the mark reads as
            the letterhead and the legal text sits under it as one block,
            instead of two columns competing for the eye. */}
        {/* Logo, then the trading name, then a LABELLED GRID.
            The details were a ragged right-aligned stack — an eighty-character
            address above a twenty-character email, with the CR and VAT numbers
            running together on one line. Labels in a fixed first column give
            the eye a single edge to follow and make every value findable
            without reading the whole block. */}
        <header className="pdoc-head">
          <div className="pdoc-brand">
            <img src={s.logoUrl || '/brand/word-448.png'} alt={s.brand || 'RBT360'} className="pdoc-logo" />
            {/* The English name is CENTRED under the Arabic one: the block
                shrink-wraps to the longer (Arabic) line, so centring inside it
                puts the Latin lockup exactly under the middle of the name it
                translates rather than trailing off one edge. */}
            <div className="pdoc-names">
              <strong>{s.legalNameAr}</strong>
              <span dir="ltr" className="pdoc-ltr">{s.legalNameEn}</span>
            </div>
            {/* Stacked lines hugging the start edge — label and value sit
                TOGETHER on each line. A two-column grid pushed the values to
                the far side of the sheet and left a river of white space
                between a label and the thing it names. */}
            <div className="pdoc-seller-kv">
              <div><span>العنوان</span> {s.addressAr}</div>
              {s.contactEmail ? <div><span>البريد</span> <bdi className="pdoc-ltr">{s.contactEmail}</bdi></div> : null}
              {s.contactPhone ? <div><span>الهاتف</span> <bdi className="pdoc-ltr pdoc-num">{s.contactPhone}</bdi></div> : null}
              <div><span>السجل التجاري</span> <bdi className="pdoc-ltr pdoc-num">{s.crNumber}</bdi></div>
              <div><span>الرقم الضريبي</span> <bdi className="pdoc-ltr pdoc-num">{s.vatNumber}</bdi></div>
            </div>
          </div>
          {/* Same treatment as the seller block: a tight stack where each line
              carries its own label, so nothing drifts across the sheet. */}
          <div className="pdoc-meta">
            <div className="pdoc-titles">
              <div className="pdoc-title">{TITLE[variant] || TITLE.taxInvoice}</div>
              <div className="pdoc-title-en">{TITLE_EN[variant] || ''}</div>
            </div>
            <div className="pdoc-no" dir="ltr">{doc.no}</div>
            <div className="pdoc-kv">
              <div><span>التاريخ</span> {dateAr(doc.issuedAtMs)}</div>
              {isQuote
                ? <div className={expired ? 'pdoc-danger' : ''}><span>ساري حتى</span> {dateAr(doc.validUntil)}</div>
                : <div><span>الاستحقاق</span> {dateAr(doc.dueAt)}</div>}
            </div>
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
