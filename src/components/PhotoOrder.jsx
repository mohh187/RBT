import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { httpsCallable } from 'firebase/functions'
import { functions, firebaseReady } from '../lib/firebase.js'
import { usePortalRoot } from './PortalRoot.jsx'
import { pickLang } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'
import { Price } from './Riyal.jsx'
import { matchItems } from '../lib/voiceOrder.js'

// «اطلب بالصورة» — the guest photographs a dish (a friend's plate, a screenshot,
// a printed menu photo) and we find the closest items on THIS venue's menu.
//
// Anti-hallucination contract: Gemini only ever picks from a name list we send,
// and whatever it returns is re-resolved against the REAL item array with the
// local matcher. A name the model invented simply fails to map and is dropped —
// an imaginary dish can never become an orderable card.

const VISION_MODEL = 'gemini-2.5-flash'

const COPY = {
  ar: {
    title: 'اطلب بالصورة',
    intro: 'صوّر الطبق الذي تريده وسنبحث عن أقرب صنف في منيو المطعم.',
    take: 'التقط صورة',
    change: 'صورة أخرى',
    analyze: 'ابحث عن الصنف',
    scanning: 'نحلل الصورة…',
    results: 'أقرب الأصناف في المنيو',
    open: 'اعرض الصنف',
    none: 'لم نجد صنفاً مشابهاً في منيو المطعم.',
    noneHint: 'جرّب صورة أوضح للطبق نفسه، أو تصفّح المنيو يدوياً.',
    confidence: 'التطابق',
    noAi: 'خدمة تحليل الصور غير مهيأة لهذه المنشأة.',
    failed: 'تعذر تحليل الصورة — أعد المحاولة بعد لحظات.',
    tooBig: 'الصورة كبيرة جداً — التقط صورة أصغر أو أقل جودة.',
    retry: 'إعادة المحاولة',
  },
  en: {
    title: 'Order by photo',
    intro: 'Photograph the dish you want and we will find the closest item on the menu.',
    take: 'Take a photo',
    change: 'Another photo',
    analyze: 'Find the dish',
    scanning: 'Analysing the photo…',
    results: 'Closest items on the menu',
    open: 'View item',
    none: 'We could not find a similar item on this menu.',
    noneHint: 'Try a clearer photo of the dish itself, or browse the menu.',
    confidence: 'Match',
    noAi: 'Photo analysis is not configured for this venue.',
    failed: 'Could not analyse the photo — please try again.',
    tooBig: 'That photo is too large — try a smaller one.',
    retry: 'Try again',
  },
}

const MAX_BYTES = 4.5 * 1024 * 1024 // inline request cap; larger files are rejected honestly

// File/Blob -> Gemini inlineData part (same pattern as postGen.js).
function blobToInlineData(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => {
      const [head, data] = String(fr.result).split(',')
      const mimeType = /data:(.*?)[;,]/.exec(`${head},`)?.[1] || blob.type || 'image/jpeg'
      resolve({ mimeType, data })
    }
    fr.onerror = () => reject(new Error('read failed'))
    fr.readAsDataURL(blob)
  })
}

// geminiProxy (prod, server key) first, then a direct call when a local dev key exists.
async function sendVision(body) {
  try {
    const res = await httpsCallable(functions, 'geminiProxy')({ model: VISION_MODEL, body })
    return res.data
  } catch (e) {
    const key = import.meta.env.VITE_GEMINI_API_KEY
    if (!key) throw new Error(String(e?.message || e))
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  }
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

export default function PhotoOrder({ open, onClose, items = [], tenant = null, lang = 'ar', currency = 'SAR', onPick }) {
  const portalRoot = usePortalRoot()
  const t = COPY[lang === 'en' ? 'en' : 'ar']
  const fileRef = useRef(null)
  const urlRef = useRef('')

  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState(null) // null = not run yet, [] = ran and found nothing
  const [err, setErr] = useState('')

  const revoke = () => { if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = '' } }
  useEffect(() => () => revoke(), [])

  const reset = () => { revoke(); setFile(null); setPreview(''); setResults(null); setErr(''); setBusy(false) }

  useEffect(() => { if (!open) reset() }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])

  const onFile = (e) => {
    const f = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!f) return
    setErr(''); setResults(null)
    if (f.size > MAX_BYTES) { setErr(t.tooBig); return }
    revoke()
    urlRef.current = URL.createObjectURL(f)
    setFile(f)
    setPreview(urlRef.current)
  }

  const analyze = async () => {
    if (!file || busy) return
    if (!firebaseReady) { setErr(t.noAi); return }
    setBusy(true); setErr(''); setResults(null)
    try {
      const inline = await blobToInlineData(file)
      // The venue's real menu vocabulary — the model may not answer outside it.
      const names = (items || [])
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
      const json = await sendVision(body)
      const raw = (json?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('')
      const proposed = parseMatches(raw)

      // Re-resolve every proposed name against the REAL items. Unmapped (i.e.
      // hallucinated) names are dropped rather than shown.
      const seen = new Set()
      const mapped = []
      for (const m of proposed) {
        const ranked = matchItems(m.name, items, lang)
        const hit = ranked[0]
        if (!hit || hit.score < 3) continue
        if (seen.has(hit.item.id)) continue
        seen.add(hit.item.id)
        mapped.push({ item: hit.item, confidence: m.confidence, why: m.why })
      }
      setResults(mapped)
    } catch (_) {
      setErr(t.failed)
    } finally {
      setBusy(false)
    }
  }

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
              <button type="button" className="po-empty" onClick={() => fileRef.current?.click()}>
                <Icon name="camera" size={38} />
                <span>{t.take}</span>
              </button>
            )}
          {busy && <span className="po-scanline" aria-hidden="true" />}
        </div>

        <input
          ref={fileRef}
          className="po-file"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFile}
          aria-label={t.take}
        />

        <div className="po-actions">
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Icon name="camera" size={16} /> {preview ? t.change : t.take}
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
