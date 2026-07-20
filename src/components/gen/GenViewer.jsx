import { useState } from 'react'
import Sheet from '../Sheet.jsx'
import Icon from '../Icon.jsx'
import GenImageZoom from './GenImageZoom.jsx'
import { useToast } from '../Toast.jsx'
import { fmtDuration, fmtWhen, kindIcon, kindLabel, resultKindOf, sectionLabel } from '../../lib/genLog.js'

// Full record of one generation: the result large, the EXACT prompt that produced
// it, the reference images, and the facts (model, duration, who, when).
//
// «أعد الاستخدام» deliberately only copies the prompt to the clipboard and says
// where to paste it. Re-running from here would need every generator's own
// options and credit checks, so pretending to do it would be a lie.
export default function GenViewer({ row, onClose, onDelete, ar = true, itemName = '' }) {
  const toast = useToast()
  const [zoom, setZoom] = useState('')
  const [busy, setBusy] = useState(false)
  if (!row) return null

  const rk = resultKindOf(row)
  const prompt = (row.prompt || '').trim()
  const text = (row.result?.text || '').trim()
  const url = row.result?.url || ''
  const meta = row.result?.meta || null
  const failed = !row.ok

  const copy = async (value, okMsg) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      toast.success(okMsg)
    } catch (_) {
      toast.error(ar ? 'تعذّر النسخ — انسخ النص يدوياً' : 'Copy failed — select and copy manually')
    }
  }

  const reuse = () => {
    if (!prompt) {
      toast.error(ar ? 'لا يوجد برومبت مسجَّل لإعادة استخدامه' : 'No prompt recorded to reuse')
      return
    }
    const where = sectionLabel(row.section, ar)
    copy(
      prompt,
      ar ? `نُسخ البرومبت — الصقه في «${where}» وشغّل توليداً جديداً` : `Prompt copied — paste it in "${where}" and run a new generation`,
    )
  }

  const remove = async () => {
    const msg = ar
      ? 'حذف هذا السجل نهائياً؟ يُحذف السجل فقط — الصورة أو النص الناتج يبقى في مكانه إن كنت قد حفظته.'
      : 'Delete this log entry permanently? Only the entry is removed — a saved result stays where it is.'
    if (!window.confirm(msg)) return
    setBusy(true)
    try {
      await onDelete?.(row)
      toast.success(ar ? 'حُذف السجل' : 'Entry deleted')
      onClose?.()
    } catch (_) {
      toast.error(ar ? 'تعذّر حذف السجل' : 'Could not delete the entry')
    } finally {
      setBusy(false)
    }
  }

  const facts = [
    [ar ? 'النوع' : 'Kind', kindLabel(row.kind, ar)],
    [ar ? 'المكان' : 'Section', sectionLabel(row.section, ar)],
    [ar ? 'النموذج' : 'Model', row.model || (ar ? 'غير مسجَّل' : 'not recorded')],
    [ar ? 'المدة' : 'Duration', fmtDuration(row.ms, ar)],
    [ar ? 'بواسطة' : 'By', row.by?.name || (ar ? 'غير معروف' : 'unknown')],
    [ar ? 'التاريخ' : 'When', fmtWhen(row, ar)],
  ]
  if (row.itemId) facts.push([ar ? 'الصنف المرتبط' : 'Linked item', itemName || row.itemId])
  if (meta) {
    for (const [k, v] of Object.entries(meta).slice(0, 6)) {
      if (k === 'urlOmitted') continue
      facts.push([k, typeof v === 'object' ? JSON.stringify(v) : String(v)])
    }
  }

  return (
    <>
      <Sheet open onClose={onClose} tall title={ar ? 'تفاصيل التوليد' : 'Generation details'}>
        <div className="gh-v">
          {/* result */}
          {rk === 'image' && (
            <div className="gh-v-stage">
              <img src={url} alt={prompt.slice(0, 80)} onClick={() => setZoom(url)} />
              <span className="gh-v-zoomhint">{ar ? 'اضغط للتكبير' : 'Tap to zoom'}</span>
            </div>
          )}
          {rk === 'text' && <pre className="gh-v-text">{text}</pre>}
          {rk === 'none' && !failed && (
            <p className="gh-note">
              {meta?.urlOmitted
                ? ar
                  ? 'اكتمل التوليد لكن الناتج كان ملفاً مؤقتاً في المتصفح، فلم يُحفَظ رابط دائم في السجل. البرومبت أدناه هو الأهم — يمكنك إعادة استخدامه.'
                  : 'This generation succeeded but produced a temporary in-browser file, so no permanent link was stored. The prompt below is what matters — you can reuse it.'
                : ar
                  ? 'لم تُسجَّل معاينة لهذه العملية — البرومبت والتفاصيل أدناه.'
                  : 'No preview was recorded for this generation — the prompt and details are below.'}
            </p>
          )}
          {failed && (
            <div className="gh-v-err">
              <strong>{ar ? 'فشل هذا التوليد' : 'This generation failed'}</strong>
              <div style={{ marginTop: 6 }}>{row.error || (ar ? 'بدون رسالة خطأ مسجَّلة' : 'No error message recorded')}</div>
            </div>
          )}

          {/* prompt */}
          <div className="gh-v-sec">
            <span className="gh-v-sec-title">
              <Icon name="penLine" size={13} /> {ar ? 'البرومبت المستخدم بالضبط' : 'The exact prompt used'}
            </span>
            {prompt ? (
              <pre className="gh-v-prompt">{prompt}</pre>
            ) : (
              <p className="gh-note">{ar ? 'لم يُسجَّل برومبت لهذه العملية.' : 'No prompt was recorded for this generation.'}</p>
            )}
          </div>

          {/* reference images */}
          {row.refUrls?.length > 0 && (
            <div className="gh-v-sec">
              <span className="gh-v-sec-title">
                <Icon name="image" size={13} /> {ar ? 'الصور المرجعية' : 'Reference images'}
              </span>
              <div className="gh-v-refs">
                {row.refUrls.map((r) => (
                  <button key={r} type="button" className="gh-v-ref" onClick={() => setZoom(r)}>
                    <img src={r} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* facts */}
          <div className="gh-v-sec">
            <span className="gh-v-sec-title">
              <Icon name={kindIcon(row.kind)} size={13} /> {ar ? 'التفاصيل' : 'Details'}
            </span>
            <div className="gh-v-facts">
              {facts.map(([k, v]) => (
                <div className="gh-v-fact" key={k}>
                  <span className="gh-v-fact-k">{k}</span>
                  <span className="gh-v-fact-v">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* actions */}
          <div className="gh-v-actions">
            <button className="btn btn-outline btn-sm" onClick={() => copy(prompt, ar ? 'نُسخ البرومبت' : 'Prompt copied')} disabled={!prompt}>
              <Icon name="copy" size={15} /> {ar ? 'نسخ البرومبت' : 'Copy prompt'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={reuse} disabled={!prompt}>
              <Icon name="repeat" size={15} /> {ar ? 'أعد الاستخدام' : 'Reuse'}
            </button>
            {text && (
              <button className="btn btn-outline btn-sm" onClick={() => copy(text, ar ? 'نُسخ النص' : 'Text copied')}>
                <Icon name="file" size={15} /> {ar ? 'نسخ النص' : 'Copy text'}
              </button>
            )}
            {url && (
              <a className="btn btn-outline btn-sm" href={url} target="_blank" rel="noreferrer">
                <Icon name="share" size={15} /> {ar ? 'فتح الأصل' : 'Open original'}
              </a>
            )}
            <button className="btn btn-danger btn-sm" onClick={remove} disabled={busy}>
              <Icon name="delete" size={15} /> {busy ? (ar ? 'جارٍ الحذف' : 'Deleting') : ar ? 'حذف السجل' : 'Delete entry'}
            </button>
          </div>

          <p className="gh-note">
            {ar
              ? '«أعد الاستخدام» ينسخ البرومبت فقط ولا يشغّل توليداً جديداً من هنا — الصقه في القسم الذي أُنشئ منه لتتحكّم في خياراته وتكلفته.'
              : 'Reuse only copies the prompt — it does not re-run the generation from here. Paste it into the section it came from so you keep control of its options and cost.'}
          </p>
        </div>
      </Sheet>
      {zoom && <GenImageZoom src={zoom} alt={prompt.slice(0, 80)} onClose={() => setZoom('')} />}
    </>
  )
}
