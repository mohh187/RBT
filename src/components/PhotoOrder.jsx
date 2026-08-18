import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePortalRoot } from './PortalRoot.jsx'
import { useScrollLock } from '../lib/scrollLock.js'
import { pickLang } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'
import { Price } from './Riyal.jsx'
import { matchItems } from '../lib/voiceOrder.js'
import { callDinerAi, blobToInline, downscaleImage } from '../lib/dinerAi.js'
import { AI_ORDER_RANGE } from '../lib/dishComposition.js'

// «اطلب بالصورة» — the guest photographs a dish (a friend's plate, a screenshot,
// a printed menu photo) or uploads one from the gallery, and we find the
// closest items on THIS venue's menu.
//
// PRIMARY engine: the guest-facing `dinerOrderAi` callable (server builds the
// catalog itself and answers with real item ids — index-only selection, so the
// model can never invent a dish). SECONDARY (dev only): a direct Gemini call
// behind VITE_GEMINI_API_KEY where the anti-hallucination contract is the old
// one — names re-resolved through the local matcher, unmapped names dropped.
// Ids from the server are re-validated against the FULL active item list
// (allItems), never the filtered view, so a correct match on another category
// tab is not silently dropped.

const VISION_MODEL = 'gemini-2.5-flash'

const COPY = {
  ar: {
    title: 'اطلب بالصورة',
    intro: 'صوّر الطبق الذي تريده أو ارفع صورته وسنبحث عن أقرب صنف في منيو المطعم.',
    take: 'التقط صورة',
    upload: 'ارفع من الاستوديو',
    change: 'صورة أخرى',
    analyze: 'ابحث عن الصنف',
    scanning: 'نحلل الصورة…',
    results: 'أقرب الأصناف في المنيو',
    open: 'اعرض الصنف',
    none: 'لم نجد صنفاً مشابهاً في منيو المطعم.',
    noneHint: 'جرّب صورة أوضح للطبق نفسه، أو تصفّح المنيو يدوياً.',
    confidence: 'التطابق',
    noAi: 'الطلب بالصورة غير متاح هنا حالياً، تصفّح المنيو واختر ما تريد.',
    failed: 'ما قدرنا نقرأ الصورة. جرّب مرة أخرى بعد لحظات.',
    tooBig: 'الصورة كبيرة جداً. التقط صورة أصغر وأعد المحاولة.',
    quota: 'خدمة التحليل مشغولة الآن، جرّب بعد قليل.',
    retry: 'إعادة المحاولة',
  },
  en: {
    title: 'Order by photo',
    intro: 'Photograph the dish you want, or upload it from your gallery, and we will find the closest item on the menu.',
    take: 'Take a photo',
    upload: 'Upload from gallery',
    change: 'Another photo',
    analyze: 'Find the dish',
    scanning: 'Analysing the photo…',
    results: 'Closest items on the menu',
    open: 'View item',
    none: 'We could not find a similar item on this menu.',
    noneHint: 'Try a clearer photo of the dish itself, or browse the menu.',
    confidence: 'Match',
    noAi: 'Ordering by photo is not available here yet. Browse the menu and pick what you want.',
    failed: 'We could not read that photo. Please try again in a moment.',
    tooBig: 'That photo is too large. Take a smaller one and try again.',
    quota: 'The photo service is busy right now. Try again shortly.',
    retry: 'Try again',
  },
}

// Dev-only direct Gemini call (VITE_GEMINI_API_KEY, never set in prod builds).
async function devVision(body) {
  const key = (import.meta.env.DEV ? import.meta.env.VITE_GEMINI_API_KEY : '')
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}

// Models wrap JSON in prose or fences no matter how firmly you ask — parse defensively.
function parseMatches(raw) {
  const text = String(raw || '').trim()
  if (!text) return []
  const attempts = [text]
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (fenced) attempts.unshift(fenced[1])
  const braced = /\{[\s\S]*\}/.exec(text)
  if (braced) attempts.push(braced[0])
  for (const candidate of attempts) {
    try {
      const obj = JSON.parse(candidate)
      const list = Array.isArray(obj) ? obj : obj?.matches
      if (Array.isArray(list)) {
        return list
          .map((m) => ({
            name: String(m?.name || '').trim(),
            confidence: Math.max(0, Math.min(100, Math.round(Number(m?.confidence) || 0))),
            why: String(m?.why || '').trim(),
          }))
          .filter((m) => m.name)
      }
    } catch (_) { /* try the next shape */ }
  }
  return []
}

export default function PhotoOrder({ open, onClose, items = [], allItems = null, tenant = null, tenantId = '', lang = 'ar', currency = 'SAR', onPick, cloudEnabled = true, preview: previewMode = false }) {
  const portalRoot = usePortalRoot()
  const t = COPY[lang === 'en' ? 'en' : 'ar']
  const cameraRef = useRef(null)
  const galleryRef = useRef(null)
  const urlRef = useRef('')
  // id re-validation universe: the FULL active list when the parent passes it,
  // else the (possibly filtered) items prop
  const universe = (allItems && allItems.length ? allItems : items) || []
  const tid = tenantId || tenant?.id || ''
  // the studio preview must never burn real quota
  const cloudOk = cloudEnabled !== false && !previewMode

  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState(null) // null = not run yet, [] = ran and found nothing
  const [err, setErr] = useState('')

  const revoke = () => { if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = '' } }
  useEffect(() => () => revoke(), [])

  const reset = () => { revoke(); setFile(null); setPreview(''); setResults(null); setErr(''); setBusy(false) }

  useEffect(() => { if (!open) reset() }, [open])

  useScrollLock(open)
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const onFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!f) return
    setErr(''); setResults(null)
    // canvas downscale first — modern phone photos are routinely 5-12MB and the
    // old hard reject made that a dead-end; tooBig now fires only for files
    // that stay oversized even after the resize (or refuse to decode)
    let use = f
    try { use = await downscaleImage(f) } catch (_) { /* keep the original */ }
    if (use.size > AI_ORDER_RANGE.photoMaxBytes.dflt) { setErr(t.tooBig); return }
    revoke()
    urlRef.current = URL.createObjectURL(use)
    setFile(use)
    setPreview(urlRef.current)
    // optimistic: recognition starts the moment the picture lands (one tap)
    analyzeWith(use)
  }

  // Dev-only secondary engine: direct Gemini with the venue name list; every
  // proposed name is re-resolved through the local matcher and hallucinated
  // names are dropped rather than shown.
  const devAnalyze = async (inline) => {
    const names = universe
      .filter((i) => i && (i.nameAr || i.nameEn))
      .slice(0, 160)
      .map((i) => `${i.nameAr || ''}${i.nameEn ? ` / ${i.nameEn}` : ''}`)
    const prompt = [
      `You identify food and drinks for the venue "${tenant?.name || 'a cafe'}".`,
      'STEP 1: Look at the attached photo and identify the dish or drink it shows.',
      'STEP 2: Choose the closest matches ONLY from this exact menu list. You may NOT invent, translate, or modify a name — copy it verbatim from the list.',
      `MENU LIST:\n${names.map((n) => `- ${n}`).join('\n')}`,
      'If nothing on the list plausibly matches what is in the photo, return an EMPTY matches array. Never force a match.',
      'Return up to 4 matches, best first.',
      'Answer with STRICT JSON only, no prose and no code fences:',
      '{"matches":[{"name":"<verbatim name from the list>","confidence":<integer 0-100>,"why":"<short reason in Arabic>"}]}',
      'The "why" text must be short Arabic, with no emojis and using Latin digits only.',
    ].join('\n')
    const body = {
      contents: [{ role: 'user', parts: [{ inlineData: inline }, { text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }
    const json = await devVision(body)
    const raw = (json?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('')
    const proposed = parseMatches(raw)
    const seen = new Set()
    const mapped = []
    for (const m of proposed) {
      const ranked = matchItems(m.name, universe, lang)
      const hit = ranked[0]
      if (!hit || hit.score < 3) continue
      if (seen.has(hit.item.id)) continue
      seen.add(hit.item.id)
      mapped.push({ item: hit.item, confidence: m.confidence, why: m.why })
    }
    return mapped
  }

  const analyzeWith = async (f) => {
    if (!f) return
    setBusy(true); setErr(''); setResults(null)
    try {
      const inline = await blobToInline(f)
      const devKey = (import.meta.env.DEV ? import.meta.env.VITE_GEMINI_API_KEY : '')
      if (cloudOk) {
        try {
          // PRIMARY: the guest callable — server-built catalog, id answers
          const res = await callDinerAi({ tenantId: tid, mode: 'photo', media: inline, lang })
          const list = Array.isArray(res?.matches) ? res.matches : (Array.isArray(res?.lines) ? res.lines : [])
          const seen = new Set()
          const mapped = []
          for (const m of list) {
            const item = universe.find((i) => i && i.id === m.id)
            if (!item || seen.has(item.id)) continue
            seen.add(item.id)
            mapped.push({
              item,
              confidence: Math.max(0, Math.min(100, Math.round(Number(m.confidence) || 0))),
              why: String(m.why || '').trim(),
            })
          }
          setResults(mapped)
          return
        } catch (e) {
          if (e?.code === 'quota') { setErr(t.quota); return }
          if (e?.code === 'disabled') { setErr(t.noAi); return }
          if (e?.code === 'toolarge') { setErr(t.tooBig); return }
          if (!devKey) { setErr(t.failed); return }
          // else fall through to the dev-only engine below
        }
      } else if (!devKey) { setErr(t.noAi); return }
      setResults(await devAnalyze(inline))
    } catch (_) {
      setErr(t.failed)
    } finally {
      setBusy(false)
    }
  }

  // thin retry wrapper — the retry/primary buttons and auto-analyze share ONE path
  const analyze = () => { if (file && !busy) analyzeWith(file) }

  if (!open || !portalRoot) return null

  return createPortal(
    <div className="vw-overlay po-overlay" role="dialog" aria-modal="true" aria-label={t.title}>
      <div className="vw-top">
        <button type="button" className="icon-btn vw-x" onClick={onClose} aria-label={lang === 'en' ? 'Close' : 'إغلاق'}>
          <Icon name="close" size={18} />
        </button>
        <strong className="vw-title">{t.title}</strong>
      </div>

      <div className="vw-body">
        <p className="vw-hint po-intro">{t.intro}</p>

        <div className={`po-stage${busy ? ' scanning' : ''}`}>
          {preview
            ? <img className="po-img" src={preview} alt="" />
            : (
              <div className="po-empty-row">
                <button type="button" className="po-empty" onClick={() => cameraRef.current?.click()}>
                  <Icon name="camera" size={34} />
                  <span>{t.take}</span>
                </button>
                <button type="button" className="po-empty" onClick={() => galleryRef.current?.click()}>
                  <Icon name="upload" size={34} />
                  <span>{t.upload}</span>
                </button>
              </div>
            )}
          {busy && <span className="po-scanline" aria-hidden="true" />}
        </div>

        {/* two entry paths: capture forces the camera app; the gallery input
            (no capture attribute) opens the photo library */}
        <input
          ref={cameraRef}
          className="po-file"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFile}
          aria-label={t.take}
        />
        <input
          ref={galleryRef}
          className="po-file"
          type="file"
          accept="image/*"
          onChange={onFile}
          aria-label={t.upload}
        />

        <div className="po-actions">
          <button type="button" className="btn btn-ghost" onClick={() => cameraRef.current?.click()} disabled={busy}>
            <Icon name="camera" size={16} /> {preview ? t.change : t.take}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => galleryRef.current?.click()} disabled={busy}>
            <Icon name="upload" size={16} /> {t.upload}
          </button>
          <button type="button" className="btn btn-primary" onClick={analyze} disabled={!file || busy}>
            <Icon name="sparkles" size={16} /> {busy ? t.scanning : t.analyze}
          </button>
        </div>

        <div className="vw-say" aria-live="polite" role="status">{busy ? t.scanning : ''}</div>

        {err && (
          <div className="vw-card vw-warn">
            <span className="vw-warn-ico"><Icon name="warning" size={22} /></span>
            <b>{err}</b>
            {file && <button type="button" className="btn btn-primary btn-block" onClick={analyze}>{t.retry}</button>}
          </div>
        )}

        {results && results.length === 0 && !err && (
          <div className="vw-card vw-warn">
            <span className="vw-warn-ico"><Icon name="search" size={22} /></span>
            <b>{t.none}</b>
            <p className="vw-hint">{t.noneHint}</p>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="po-results">
            <b className="vw-choose-title">{t.results}</b>
            {results.map((r) => (
              <div key={r.item.id} className="po-card">
                {r.item.imageUrl
                  ? <img className="po-card-img" src={r.item.imageUrl} alt="" loading="lazy" />
                  : <span className="po-card-img vw-choice-ph"><Icon name="coffee" size={20} /></span>}
                <div className="po-card-txt">
                  <b>{pickLang(r.item, 'name', lang)}</b>
                  <span className="po-card-price"><Price value={r.item.price || 0} currency={currency} lang={lang} /></span>
                  {r.why && <span className="vw-hint">{r.why}</span>}
                  {r.confidence > 0 && (
                    <span className="po-conf" title={t.confidence}>
                      <span className="po-conf-bar"><span className="po-conf-fill" style={{ width: `${r.confidence}%` }} /></span>
                      <span className="po-conf-n" dir="ltr">{r.confidence}%</span>
                    </span>
                  )}
                  <button type="button" className="btn btn-primary po-open" onClick={() => onPick?.(r.item)}>{t.open}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    portalRoot,
  )
}
