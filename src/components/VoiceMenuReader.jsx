import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePortalRoot } from './PortalRoot.jsx'
import { pickLang } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'
import { Price } from './Riyal.jsx'
import {
  speechSupported, speechAvailable, listenOnce, stopListening, speak, stopSpeaking,
  speechErrorText, normalizeAr, normalizedAlt, needsChoices, priceSpeech,
} from '../lib/voiceOrder.js'

// «المنيو الصوتي» — an accessibility mode for blind and low-vision guests.
// The menu is read aloud item by item; between items we listen for a short
// command. It is NEVER voice-only: every control is also a large high-contrast
// button, and the current item is mirrored into an aria-live region so a screen
// reader announces it even with speech synthesis off.

const COPY = {
  ar: {
    title: 'المنيو الصوتي',
    empty: 'لا توجد أصناف لقراءتها حالياً.',
    prev: 'السابق',
    next: 'التالي',
    repeat: 'إعادة',
    addItem: 'أضف للسلة',
    nextCat: 'التصنيف التالي',
    stop: 'إيقاف',
    listen: 'استمع لأمر',
    autoOn: 'الأوامر الصوتية تعمل',
    autoOff: 'الأوامر الصوتية متوقفة',
    listening: 'أستمع…',
    commands: 'قل: التالي · السابق · أضف · التصنيف التالي · إعادة · توقف',
    item: 'الصنف',
    of: 'من',
    added: 'تمت الإضافة',
    needs: 'هذا الصنف يحتاج اختيارات — سنفتحه لك.',
    close: 'إغلاق',
  },
  en: {
    title: 'Voice menu',
    empty: 'There are no items to read right now.',
    prev: 'Previous',
    next: 'Next',
    repeat: 'Repeat',
    addItem: 'Add to cart',
    nextCat: 'Next category',
    stop: 'Stop',
    listen: 'Listen for a command',
    autoOn: 'Voice commands on',
    autoOff: 'Voice commands off',
    listening: 'Listening…',
    commands: 'Say: next / previous / add / next category / repeat / stop',
    item: 'Item',
    of: 'of',
    added: 'Added',
    needs: 'This item needs choices — opening it for you.',
    close: 'Close',
  },
}

// Order matters: "next category" must be tested before plain "next".
// Patterns are folded through the SAME normalizer as the transcript (see
// normalizedAlt) — a literal Arabic regex here would silently never match.
const COMMANDS = [
  ['nextCat', normalizedAlt(['التصنيف التالي', 'القسم التالي', 'تصنيف التالي', 'قسم التالي', 'next category', 'next section'])],
  ['stop', normalizedAlt(['توقف', 'اسكت', 'كفى', 'خلاص', 'إنهاء', 'stop', 'quiet', 'silence'])],
  ['repeat', normalizedAlt(['إعادة', 'أعد', 'كرر', 'مرة ثانية', 'repeat', 'again'])],
  ['add', normalizedAlt(['أضف', 'ضيف', 'أضيف', 'أبغى', 'أبغا', 'أبي', 'أريد', 'هذا', 'هذي', 'add', 'i want', 'this one'])],
  ['prev', normalizedAlt(['السابق', 'السابقة', 'قبله', 'قبلها', 'رجوع', 'ارجع', 'previous', 'back', 'prev'])],
  ['next', normalizedAlt(['التالي', 'التالية', 'بعده', 'بعدها', 'كمل', 'واصل', 'next', 'continue', 'forward'])],
]

function parseCommand(text = '') {
  const norm = normalizeAr(text)
  if (!norm) return ''
  for (const [cmd, re] of COMMANDS) if (re.test(norm)) return cmd
  return ''
}

export default function VoiceMenuReader({ open, onClose, cats = [], itemsByCat = {}, lang = 'ar', currency = 'SAR', onOpenItem, onAdd }) {
  const portalRoot = usePortalRoot()
  const t = COPY[lang === 'en' ? 'en' : 'ar']
  const speechLang = lang === 'en' ? 'en-US' : 'ar-SA'
  const canListen = speechSupported()

  // One flat reading order across every category, each entry knowing where it sits.
  const flat = useMemo(() => {
    const rows = []
    const seen = new Set()
    const push = (catId, catName, list) => {
      const arr = (list || []).filter((i) => i && i.available !== false)
      arr.forEach((item, i) => {
        if (seen.has(item.id)) return
        seen.add(item.id)
        rows.push({ item, catId, catName, pos: i + 1, count: arr.length })
      })
    }
    ;(cats || []).forEach((c) => push(c.id, pickLang(c, 'name', lang) || '', itemsByCat?.[c.id]))
    if (itemsByCat?._uncat) push('_uncat', '', itemsByCat._uncat)
    return rows
  }, [cats, itemsByCat, lang])

  const [idx, setIdx] = useState(0) // remembered while the reader stays mounted
  const [current, setCurrent] = useState('')
  const [listening, setListening] = useState(false)
  const [partial, setPartial] = useState('')
  const [auto, setAuto] = useState(true)
  const [err, setErr] = useState('')

  const seqRef = useRef(0)
  const autoRef = useRef(auto)
  const openRef = useRef(open)
  const boxRef = useRef(null)
  useEffect(() => { autoRef.current = auto }, [auto])
  useEffect(() => { openRef.current = open }, [open])

  const safeIdx = flat.length ? Math.min(idx, flat.length - 1) : 0
  const row = flat[safeIdx] || null

  // Spoken + displayed description of one item.
  const textFor = (i) => {
    const r = flat[i]
    if (!r) return ''
    const name = pickLang(r.item, 'name', lang)
    const desc = String(pickLang(r.item, 'desc', lang) || r.item.descAr || r.item.descriptionAr || '').trim()
    const base = (r.item.variants && r.item.variants.length ? r.item.variants[0].price : r.item.price) || 0
    return [
      r.catName,
      `${t.item} ${r.pos} ${t.of} ${r.count}`,
      name,
      priceSpeech(base, currency, lang),
      desc ? desc.slice(0, 180) : '',
    ].filter(Boolean).join('. ')
  }

  // Hard stop — a dangling utterance that keeps talking after close is a real bug.
  const shutdown = () => {
    seqRef.current += 1
    stopListening()
    stopSpeaking()
    setListening(false)
    setPartial('')
  }
  useEffect(() => () => { stopListening(); stopSpeaking() }, [])

  const listenForCommand = async (token) => {
    if (!canListen) return
    setListening(true)
    setPartial('')
    try {
      const said = await listenOnce({ lang: speechLang, onPartial: setPartial, silenceMs: 8000 })
      if (seqRef.current !== token || !openRef.current) return
      setListening(false)
      setPartial('')
      run(parseCommand(said))
    } catch (e) {
      if (seqRef.current !== token) return
      setListening(false)
      setPartial('')
      if (e?.code === 'denied' || e?.code === 'unsupported' || e?.code === 'network') {
        setAuto(false)
        setErr(speechErrorText(e.code, lang))
      }
      // 'nomatch' is normal silence: stop listening and wait for a button press.
    }
  }

  // Read entry `i` aloud, then (optionally) listen for the next command.
  const go = (i, { listenAfter = true } = {}) => {
    if (!flat.length) return
    const clamped = Math.max(0, Math.min(flat.length - 1, i))
    const token = ++seqRef.current
    stopListening()
    stopSpeaking()
    setListening(false)
    setPartial('')
    setIdx(clamped)
    const text = textFor(clamped)
    setCurrent(text)
    const after = () => {
      if (seqRef.current !== token || !openRef.current) return
      if (listenAfter && autoRef.current && canListen) listenForCommand(token)
    }
    if (speechAvailable()) speak(text, { lang: speechLang }).then(after)
    else after()
  }

  const nextCategoryIdx = (from) => {
    const cur = flat[from]?.catId
    for (let i = from + 1; i < flat.length; i++) if (flat[i].catId !== cur) return i
    return 0 // wrap to the beginning
  }

  const addCurrent = () => {
    const r = flat[safeIdx]
    if (!r) return
    if (needsChoices(r.item)) {
      setCurrent(t.needs)
      const token = ++seqRef.current
      stopListening()
      const open3 = () => { if (seqRef.current === token) { shutdown(); onOpenItem?.(r.item); onClose?.() } }
      if (speechAvailable()) speak(t.needs, { lang: speechLang }).then(open3)
      else open3()
      return
    }
    const variant = (r.item.variants && r.item.variants.length) ? r.item.variants[0] : null
    onAdd?.(r.item, variant, [], 1)
    const name = pickLang(r.item, 'name', lang)
    const token = ++seqRef.current
    const msg = `${name}: ${t.added}`
    setCurrent(msg)
    const after = () => { if (seqRef.current === token && openRef.current && autoRef.current && canListen) listenForCommand(token) }
    if (speechAvailable()) speak(msg, { lang: speechLang }).then(after)
    else after()
  }

  const run = (cmd) => {
    if (cmd === 'next') go(safeIdx + 1)
    else if (cmd === 'prev') go(safeIdx - 1)
    else if (cmd === 'repeat') go(safeIdx)
    else if (cmd === 'nextCat') go(nextCategoryIdx(safeIdx))
    else if (cmd === 'add') addCurrent()
    else if (cmd === 'stop') shutdown()
    // unrecognised: stay put; the guest can press a button or the mic again
  }

  // Open: focus the dialog, start reading from the remembered position.
  useEffect(() => {
    if (!open) { shutdown(); return undefined }
    setErr('')
    boxRef.current?.focus?.()
    if (flat.length) go(safeIdx)
    const onKey = (e) => { if (e.key === 'Escape') { shutdown(); onClose?.() } }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open])

  if (!open || !portalRoot) return null

  const price = row ? ((row.item.variants && row.item.variants.length ? row.item.variants[0].price : row.item.price) || 0) : 0

  return createPortal(
    <div
      className="vmr-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t.title}
      tabIndex={-1}
      ref={boxRef}
    >
      <div className="vmr-top">
        <button type="button" className="icon-btn vw-x" onClick={() => { shutdown(); onClose?.() }} aria-label={t.close}>
          <Icon name="close" size={18} />
        </button>
        <strong className="vmr-title">{t.title}</strong>
        <button
          type="button"
          className={`vw-sound${auto ? ' on' : ''}`}
          onClick={() => { if (auto) { stopListening(); setListening(false) } setAuto((v) => !v) }}
          aria-pressed={auto}
          aria-label={auto ? t.autoOn : t.autoOff}
          disabled={!canListen}
        >
          <Icon name="mic" size={17} />
        </button>
      </div>

      <div className="vmr-body">
        {!flat.length ? (
          <div className="vw-card vw-warn">
            <span className="vw-warn-ico"><Icon name="warning" size={22} /></span>
            <b>{t.empty}</b>
          </div>
        ) : (
          <>
            <div className="vmr-stage">
              {row?.catName && <div className="vmr-cat">{row.catName}</div>}
              <div className="vmr-pos" dir="ltr">{`${row.pos} / ${row.count}`}</div>
              <h2 className="vmr-name">{pickLang(row.item, 'name', lang)}</h2>
              <div className="vmr-price"><Price value={price} currency={currency} lang={lang} /></div>
            </div>

            {/* Everything spoken is also announced here for screen readers. */}
            <p className="vmr-live" aria-live="polite" role="status">{current}</p>

            {listening && (
              <div className="vmr-listen" aria-live="polite">
                <span className="vmr-dot" aria-hidden="true" />
                <span>{partial || t.listening}</span>
              </div>
            )}

            {err && <p className="vmr-err" role="alert">{err}</p>}

            <div className="vmr-grid">
              <button type="button" className="vmr-btn" onClick={() => go(safeIdx - 1)} disabled={safeIdx === 0}>
                <Icon name={lang === 'en' ? 'back' : 'next'} size={26} />
                <span>{t.prev}</span>
              </button>
              <button type="button" className="vmr-btn" onClick={() => go(safeIdx)}>
                <Icon name="reload" size={26} />
                <span>{t.repeat}</span>
              </button>
              <button type="button" className="vmr-btn" onClick={() => go(safeIdx + 1)} disabled={safeIdx >= flat.length - 1}>
                <Icon name={lang === 'en' ? 'next' : 'back'} size={26} />
                <span>{t.next}</span>
              </button>
              <button type="button" className="vmr-btn vmr-btn-add" onClick={addCurrent}>
                <Icon name="cart" size={26} />
                <span>{t.addItem}</span>
              </button>
              <button type="button" className="vmr-btn" onClick={() => go(nextCategoryIdx(safeIdx))}>
                <Icon name="categories" size={26} />
                <span>{t.nextCat}</span>
              </button>
              <button type="button" className="vmr-btn" onClick={shutdown}>
                <Icon name="stop" size={26} />
                <span>{t.stop}</span>
              </button>
            </div>

            {canListen && (
              <button
                type="button"
                className="btn btn-ghost btn-block vmr-mic-btn"
                onClick={() => listenForCommand(++seqRef.current)}
                disabled={listening}
              >
                <Icon name="mic" size={16} /> {listening ? t.listening : t.listen}
              </button>
            )}
            <p className="vmr-help">{canListen ? t.commands : speechErrorText('unsupported', lang)}</p>
          </>
        )}
      </div>
    </div>,
    portalRoot,
  )
}
