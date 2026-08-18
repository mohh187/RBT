import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { QR_STYLES, renderQrSvg, verifyQrSvg, qrMinMm, qrStyleById } from '../lib/qrStyles.js'
import '../styles/qr-picker.css'

// QR STYLE PICKER — one component, both print surfaces (table stickers and the
// free-form studio), so a style added to the library appears in both without a
// second implementation.
//
// The thumbnails encode the REAL payload, not a placeholder. A style's density
// changes with the URL length, so previewing a dummy string would show the user a
// pattern they will never print.
//
// THE BADGE IS EARNED, NOT ASSERTED. Below the preview the selected style is
// actually decoded back from its own rendered output before it is called
// «مُختبَر». Anything else would be a guess dressed as a guarantee — and the cost
// of being wrong is a few hundred stickers on tables that no phone can read.

export default function QrStylePicker({
  value = 'classic', onChange, text, dark = '#111111', dark2 = '', light = '#ffffff',
  logoUrl = '', printedMm = 0, compact = false,
}) {
  const [thumbs, setThumbs] = useState({})
  const [open, setOpen] = useState(!compact)
  const [verdict, setVerdict] = useState(null) // null = testing
  const runId = useRef(0)

  const style = qrStyleById(value)
  const minMm = qrMinMm(value)
  const tooSmall = printedMm > 0 && printedMm < minMm

  // Thumbnails: short payload, small pixel budget — these are for choosing a look,
  // not for proving scannability (that is the verdict below).
  useEffect(() => {
    if (!text || !open) return
    let alive = true
    ;(async () => {
      const out = {}
      for (const st of QR_STYLES) {
        try {
          const { svg } = await renderQrSvg(text, { styleId: st.id, dark, dark2, light, logoUrl })
          out[st.id] = svg
        } catch (_) { /* one bad style must not blank the whole picker */ }
        if (!alive) return
      }
      if (alive) setThumbs(out)
    })()
    return () => { alive = false }
  }, [text, open, dark, dark2, light, logoUrl])

  // Verify the SELECTED style only — decoding is comparatively expensive and the
  // other nineteen are not what is about to be printed. Debounced 350ms: the
  // color inputs fire per drag-tick, and each undebounced change queued a full
  // render + scanFile decode (the work outlived the runId guard).
  useEffect(() => {
    if (!text) return
    const id = ++runId.current
    setVerdict(null)
    const timer = setTimeout(async () => {
      try {
        const { svg, version, ec } = await renderQrSvg(text, { styleId: value, dark, dark2, light, logoUrl })
        const v = await verifyQrSvg(svg, text)
        if (runId.current === id) setVerdict({ ...v, version, ec })
      } catch (e) {
        if (runId.current === id) setVerdict({ ok: null, reason: String(e?.message || e) })
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [value, text, dark, dark2, light, logoUrl])

  const riskLabel = useMemo(() => ({ low: 'آمن', med: 'متوسط', high: 'حسّاس' })[style.risk || 'low'], [style.risk])

  return (
    <div className="qrp">
      <div className="qrp-head">
        <strong className="xs faint row" style={{ gap: 5 }}><Icon name="qr" size={13} /> شكل الباركود</strong>
        <span className="qrp-current">{style.ar}</span>
        {compact && (
          <button className="btn btn-sm btn-outline" onClick={() => setOpen((o) => !o)}>
            {open ? 'إغلاق' : 'تغيير'}
          </button>
        )}
      </div>

      {/* Verdict strip — the only place allowed to claim a code scans. */}
      <div className={`qrp-verdict ${verdict === null ? 'is-testing' : verdict.ok === true ? 'is-ok' : verdict.ok === false ? 'is-bad' : 'is-unknown'}`}>
        {verdict === null ? (
          <><span className="qrp-spin" /> يُختبر المسح…</>
        ) : verdict.ok === true ? (
          <><Icon name="check" size={13} /> مُختبَر — قُرئ الرمز بنجاح (v{verdict.version} · EC {verdict.ec})</>
        ) : verdict.ok === false ? (
          <><Icon name="warning" size={13} /> لم يُقرأ هذا الشكل — اختر شكلاً آخر أو كبّر الرمز</>
        ) : (
          <><Icon name="warning" size={13} /> تعذّر الاختبار في هذا المتصفح — اختبره بجوّالك قبل الطباعة</>
        )}
      </div>

      {(tooSmall || style.risk === 'high') && (
        <p className="qrp-warn">
          {tooSmall
            ? `هذا الشكل يحتاج ${minMm} مم على الأقل، والمقاس الحالي ${Math.round(printedMm)} مم — كبّره أو اختر «كلاسيكي/شرائط/سائل».`
            : `شكل حسّاس: يغطّي مساحة أقل من الخلية، فلا تُصغّره تحت ${minMm} مم.`}
        </p>
      )}

      {open && (
        <div className="qrp-grid">
          {QR_STYLES.map((st) => (
            <button
              key={st.id}
              className={`qrp-cell ${value === st.id ? 'active' : ''}`}
              onClick={() => onChange?.(st.id)}
              title={`${st.ar} — أقل مقاس ${qrMinMm(st.id)} مم`}
            >
              <span className="qrp-thumb" dangerouslySetInnerHTML={{ __html: thumbs[st.id] || '' }} />
              <span className="qrp-name">{st.ar}</span>
              <span className={`qrp-risk r-${st.risk || 'low'}`}>{({ low: 'آمن', med: 'متوسط', high: 'حسّاس' })[st.risk || 'low']}</span>
            </button>
          ))}
        </div>
      )}

      {!open && (
        <p className="xs faint" style={{ margin: 0 }}>
          {riskLabel} · أقل مقاس {minMm} مم
        </p>
      )}
    </div>
  )
}
