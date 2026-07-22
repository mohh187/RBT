import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePortalRoot } from './PortalRoot.jsx'
import { pickLang } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'
import { Stepper } from './ui.jsx'
import { Price } from './Riyal.jsx'
import { firebaseReady } from '../lib/firebase.js'
import { callDinerAi, blobToInline } from '../lib/dinerAi.js'
import { AI_ORDER_RANGE } from '../lib/dishComposition.js'
import {
  speechSupported, speechAvailable, listenOnce, stopListening, speak, stopSpeaking,
  speechErrorText, matchItems, parseQty, parseIntent, pickVariant, needsChoices, priceSpeech,
  recorderSupported, recordOnce, stopRecording,
} from '../lib/voiceOrder.js'

// «النادل الصوتي» — the guest speaks and we confirm before anything reaches
// the cart. Every spoken line is ALSO rendered as text: this is never an
// audio-only interface.
//
// THREE engines, mutually exclusive PER ATTEMPT (SpeechRecognition and
// getUserMedia contend for the mic on Android — never run both):
//  • cloud — opt-in (tenant.voiceAiEnabled === true): MediaRecorder captures a
//    compressed clip for the dinerOrderAi callable, which understands ANY
//    language/dialect and extracts MULTIPLE items with per-item quantities.
//    Server answers with real item ids (index-only selection) that we
//    re-validate against the FULL active list (allItems) — never the filtered
//    view, or a correct match on another tab would be silently dropped.
//  • local — today's SpeechRecognition + local matcher, byte-for-byte, and the
//    INSTANT fallback when the cloud is unavailable/quota-exhausted.
//  • typed — browsers with neither engine get the form, not a dead mic.
//
// Deliberate guardrails:
//  • We never guess a required modifier — the item sheet is opened instead.
//  • One clear winner is required to auto-confirm; otherwise the guest picks.
//  • The cloud's variant resolution is HONORED (a dialect transcript would
//    defeat the local pickVariant re-derivation).
//  • Sold-out is re-checked per row at add time — stock can change between the
//    cloud call and the tap.

const COPY = {
  ar: {
    title: 'النادل الصوتي',
    sound: 'صوت المساعد',
    tapToTalk: 'اضغط وتحدث',
    listening: 'أستمع إليك…',
    thinking: 'أفهم طلبك…',
    speakNow: 'قل مثلاً: «أبغى لاتيه اثنين»',
    heard: 'سمعتك تقول',
    addIt: 'أضِف',
    cancel: 'ألغِ',
    again: 'حاول مرة أخرى',
    choose: 'أي واحد تقصد؟',
    typeInstead: 'أو اكتب طلبك هنا',
    send: 'إرسال',
    unavailable: 'هذا الصنف غير متوفر حالياً',
    openItem: 'اختر الإضافات',
    unsupportedTitle: 'التعرف على الصوت غير مدعوم في هذا المتصفح',
    unsupportedHint: 'جرّب Chrome أو Safari — أو اكتب طلبك في الحقل بالأسفل وسأبحث لك عنه.',
    multiTitle: 'فهمت طلبك — أكّده',
    addAll: 'أضف الكل',
    needsTag: 'يحتاج اختيارات — سيُفتح',
    fallingBack: 'الخدمة الذكية غير متاحة الآن — سأستخدم التعرف السريع.',
    cloudFailed: 'تعذر فهم التسجيل — أعد المحاولة أو اكتب طلبك.',
    quotaMsg: 'خدمة الصوت الذكية مشغولة مؤقتاً — جرّب بعد قليل أو اكتب طلبك.',
  },
  en: {
    title: 'Voice waiter',
    sound: 'Assistant voice',
    tapToTalk: 'Tap and speak',
    listening: 'Listening…',
    thinking: 'Understanding…',
    speakNow: 'Try: "I want two lattes"',
    heard: 'I heard',
    addIt: 'Add',
    cancel: 'Cancel',
    again: 'Try again',
    choose: 'Which one did you mean?',
    typeInstead: 'Or type your order here',
    send: 'Send',
    unavailable: 'This item is currently unavailable',
    openItem: 'Choose options',
    unsupportedTitle: 'Speech recognition is not supported in this browser',
    unsupportedHint: 'Try Chrome or Safari — or type your order below and I will look it up.',
    multiTitle: 'Here is what I got — confirm it',
    addAll: 'Add all',
    needsTag: 'Needs choices — will open',
    fallingBack: 'Smart voice is unavailable right now — using quick recognition.',
    cloudFailed: 'Could not understand the recording — try again or type your order.',
    quotaMsg: 'The smart voice service is busy — try again shortly or type your order.',
  },
}

export default function VoiceWaiter({ open, onClose, items = [], allItems = null, tenant = null, tenantId = '', lang = 'ar', currency = 'SAR', onAdd, onOpenItem, cloudEnabled = true, preview = false }) {
  const portalRoot = usePortalRoot()
  const t = COPY[lang === 'en' ? 'en' : 'ar']
  const speechLang = lang === 'en' ? 'en-US' : 'ar-SA'
  const supported = speechSupported()

  const [phase, setPhase] = useState('idle') // idle | listening | thinking | confirm | confirm-multi | choices | none | needs | error
  const [partial, setPartial] = useState('')
  const [heard, setHeard] = useState('')
  const [say, setSay] = useState('')
  const [pick, setPick] = useState(null) // { item, variant, qty }
  const [choices, setChoices] = useState([])
  const [multi, setMulti] = useState([]) // cloud multi-item confirm: [{ item, variant, qty, note }]
  const [level, setLevel] = useState(0) // 0..1 live mic level (cloud engine ring)
  const [cloudDown, setCloudDown] = useState(false) // cloud failed once -> local for this session
  const [errText, setErrText] = useState('')
  const [voiceOn, setVoiceOn] = useState(true)
  const [typed, setTyped] = useState('')

  // id re-validation universe: the FULL active list when the parent passes it,
  // else the (possibly filtered) items prop
  const universe = (allItems && allItems.length ? allItems : items) || []
  const tid = tenantId || tenant?.id || ''
  // ONE mic engine per attempt. Cloud is opt-in (=== true, default OFF) and
  // never runs from the studio preview (it would burn real quota).
  const cloudAllowed = cloudEnabled !== false && !preview && tenant?.voiceAiEnabled === true
  const engine = (!cloudDown && cloudAllowed && recorderSupported() && firebaseReady
    && (typeof navigator === 'undefined' || navigator.onLine !== false))
    ? 'cloud' : (supported ? 'local' : 'typed')

  const voiceRef = useRef(voiceOn)
  const openTimer = useRef(null)
  useEffect(() => { voiceRef.current = voiceOn }, [voiceOn])

  // Speak + always render the same words.
  const announce = (text) => {
    setSay(text)
    if (voiceRef.current && speechAvailable()) return speak(text, { lang: speechLang })
    return Promise.resolve(false)
  }

  const reset = () => {
    setPhase('idle'); setPartial(''); setHeard(''); setSay('')
    setPick(null); setChoices([]); setMulti([]); setLevel(0); setErrText(''); setTyped('')
  }

  // Hard stop: dangling recognition/recording/speech after close is a real bug.
  const shutdown = () => {
    stopListening()
    stopRecording()
    stopSpeaking()
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null }
  }
  useEffect(() => () => shutdown(), [])
  useEffect(() => {
    if (open) return undefined
    shutdown()
    reset()
    return undefined
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') { shutdown(); onClose?.() } }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])

  // ---- the pipeline (shared by voice AND the typed fallback) ----------------
  const interpret = (text) => {
    setHeard(text)
    setPartial('')
    setPhase('thinking')
    const intent = parseIntent(text)

    if (intent === 'checkout' || intent === 'cart') {
      setPhase('none')
      announce(lang === 'en'
        ? 'Open the cart at the bottom of the menu to review and place your order.'
        : 'افتح سلة الطلب من أسفل المنيو لمراجعة طلبك وإرساله.')
      return
    }
    if (intent === 'remove') {
      setPhase('none')
      announce(lang === 'en'
        ? 'You can remove items from the cart at the bottom of the menu.'
        : 'يمكنك حذف الأصناف من سلة الطلب في أسفل المنيو.')
      return
    }

    const ranked = matchItems(text, items, lang)
    if (!ranked.length) {
      setPhase('none')
      announce(lang === 'en' ? 'I did not find a matching item on the menu.' : 'لم أجد صنفاً بهذا الاسم في المنيو.')
      return
    }

    const qty = parseQty(text)
    const best = ranked[0]
    const runnerUp = ranked[1]
    const clearWinner = best.score >= 3 && (!runnerUp || best.score >= runnerUp.score * 1.5)

    if (!clearWinner) {
      setChoices(ranked.slice(0, 4).map((r) => ({ ...r, qty })))
      setPhase('choices')
      announce(t.choose)
      return
    }
    commit(best.item, qty, text)
  }

  // A single confirmed candidate — or a hand-off when we must not guess.
  // presetVariant (may be null) is the CLOUD's dialect-aware resolution and is
  // honored as-is; only when absent (undefined) do we re-derive locally.
  const commit = (item, qty, sourceText = '', presetVariant) => {
    const name = pickLang(item, 'name', lang)
    const soldOut = item.available === false || (item.trackStock && (item.stock || 0) <= 0)
    if (soldOut) {
      setPhase('none')
      announce(`${name}: ${t.unavailable}`)
      return
    }
    if (needsChoices(item)) {
      setPick({ item, variant: null, qty })
      setPhase('needs')
      const msg = lang === 'en'
        ? `${name} needs a few choices — I am opening it so you can pick them.`
        : `${name} يحتاج اختيارات — سأفتحه لك لتختار بنفسك.`
      announce(msg)
      // Open the real item sheet so required groups are respected, never guessed.
      if (openTimer.current) clearTimeout(openTimer.current)
      openTimer.current = setTimeout(() => {
        openTimer.current = null
        onOpenItem?.(item)
        onClose?.()
      }, 1600)
      return
    }
    const variant = presetVariant !== undefined ? presetVariant : pickVariant(sourceText, item)
    setPick({ item, variant, qty })
    setPhase('confirm')
    const unit = (variant ? variant.price : item.price) || 0
    announce(lang === 'en'
      ? `${name}${variant ? `, ${pickLang(variant, 'name', lang)}` : ''}, quantity ${qty}, ${priceSpeech(unit * qty, currency, lang)}. Add it?`
      : `${name}${variant ? `، ${pickLang(variant, 'name', lang)}` : ''}، الكمية ${qty}، ${priceSpeech(unit * qty, currency, lang)}. أضيفه؟`)
  }

  const startListening = async () => {
    if (!supported) return
    stopSpeaking()
    setErrText(''); setSay(''); setHeard(''); setPartial(''); setPick(null); setChoices([]); setMulti([])
    setPhase('listening')
    try {
      const text = await listenOnce({ lang: speechLang, onPartial: setPartial })
      interpret(text)
    } catch (e) {
      if (e?.code === 'aborted') { setPhase('idle'); return }
      setErrText(speechErrorText(e?.code, lang))
      setPhase('error')
    }
  }

  // ---- cloud engine: record -> dinerOrderAi -> confirm ---------------------
  const startCloud = async () => {
    stopSpeaking()
    setErrText(''); setSay(''); setHeard(''); setPartial(''); setPick(null); setChoices([]); setMulti([]); setLevel(0)
    setPhase('listening')
    try {
      const { blob, mimeType } = await recordOnce({ onLevel: setLevel })
      setLevel(0)
      setPhase('thinking')
      const media = await blobToInline(blob)
      const res = await callDinerAi({ tenantId: tid, mode: 'audio', media: { mimeType: media.mimeType || mimeType, data: media.data }, lang })
      const transcript = String(res?.transcript || '')
      // the transcript mirror keeps this from ever being audio-only
      if (transcript) setHeard(transcript)
      const raw = Array.isArray(res?.lines) ? res.lines : (Array.isArray(res?.items) ? res.items : [])
      const lines = raw.map((r) => {
        const item = universe.find((i) => i && i.id === r.id)
        // an id not on THIS menu is dropped — never orderable
        if (!item) return null
        const variants = item.variants || []
        const variant = variants.find((v) => v && v.key === r.variantKey) || (variants.length ? variants[0] : null)
        const qty = Math.min(AI_ORDER_RANGE.qty.max, Math.max(AI_ORDER_RANGE.qty.min, Number(r.qty) || AI_ORDER_RANGE.qty.dflt))
        return { item, variant, qty, note: String(r.note || r.notes || '') }
      }).filter(Boolean)
      if (!lines.length) {
        setPhase('none')
        const un = (Array.isArray(res?.unmatched) ? res.unmatched : []).filter(Boolean).map((s) => String(s))
        const missing = un.length ? ` (${un.join(lang === 'en' ? ', ' : '، ')})` : ''
        announce(res?.reply || ((lang === 'en' ? 'I did not find that on the menu.' : 'لم أجد هذا الصنف في المنيو.') + missing))
        return
      }
      if (lines.length === 1) {
        // honor the server-resolved variant — do NOT re-derive via pickVariant
        commit(lines[0].item, lines[0].qty, transcript, lines[0].variant)
        return
      }
      setMulti(lines)
      setPhase('confirm-multi')
      announce(res?.reply || t.multiTitle)
    } catch (e) {
      setLevel(0)
      if (e?.code === 'nomatch' || e?.code === 'denied') {
        setErrText(speechErrorText(e.code, lang))
        setPhase('error')
        return
      }
      // quota / disabled / offline / failed -> instant local fallback (this
      // session); startListening clears say, so the notice is set AFTER it
      setCloudDown(true)
      if (supported) {
        startListening()
        setSay(e?.code === 'quota' ? t.quotaMsg : t.fallingBack)
        return
      }
      setErrText(e?.code === 'quota' ? t.quotaMsg : t.cloudFailed)
      setPhase('error')
    }
  }

  // Add every confirmed cloud line. Sold-out is re-checked per row (stock can
  // change between the call and the tap); rows needing required choices are
  // never guessed — the first one opens the real item sheet after the simple
  // ones are added.
  const addAllMulti = () => {
    if (!multi.length) return
    let opened = null
    let added = 0
    const missed = []
    for (const ln of multi) {
      const soldOut = ln.item.available === false || (ln.item.trackStock && (ln.item.stock || 0) <= 0)
      if (soldOut) { missed.push(pickLang(ln.item, 'name', lang)); continue }
      if (needsChoices(ln.item)) { if (!opened) opened = ln.item; continue }
      onAdd?.(ln.item, ln.variant, [], ln.qty)
      added += 1
    }
    setMulti([])
    if (opened) {
      shutdown()
      onOpenItem?.(opened)
      onClose?.()
      return
    }
    setPhase('idle')
    setHeard('')
    const missTxt = missed.length
      ? (lang === 'en' ? ` ${missed.join(', ')}: currently unavailable.` : ` ${missed.join('، ')}: ${t.unavailable}.`)
      : ''
    announce((lang === 'en'
      ? (added ? `Added ${added} items. Anything else?` : 'Nothing could be added.')
      : (added ? `أضفت ${added} من الأصناف. تحب شيئاً آخر؟` : 'تعذرت إضافة الأصناف.')) + missTxt)
  }

  const confirmAdd = () => {
    if (!pick) return
    onAdd?.(pick.item, pick.variant, [], pick.qty)
    const name = pickLang(pick.item, 'name', lang)
    setPick(null)
    setPhase('idle')
    setHeard('')
    announce(lang === 'en' ? `${name} added. Anything else?` : `تمت إضافة ${name}. تحب شيئاً آخر؟`)
  }

  if (!open || !portalRoot) return null

  const busy = phase === 'listening' || phase === 'thinking'
  const micLabel = phase === 'listening' ? t.listening : phase === 'thinking' ? t.thinking : t.tapToTalk

  const submitTyped = (e) => {
    e.preventDefault()
    const text = typed.trim()
    if (!text) return
    setTyped('')
    interpret(text)
  }

  const ChoiceRow = ({ item, qty }) => {
    const price = (item.variants && item.variants.length ? item.variants[0].price : item.price) || 0
    return (
      <button type="button" className="vw-choice" onClick={() => commit(item, qty, heard)}>
        {item.imageUrl
          ? <img className="vw-choice-img" src={item.imageUrl} alt="" loading="lazy" />
          : <span className="vw-choice-img vw-choice-ph"><Icon name="coffee" size={18} /></span>}
        <span className="vw-choice-txt">
          <b>{pickLang(item, 'name', lang)}</b>
          <span><Price value={price} currency={currency} lang={lang} /></span>
        </span>
        <Icon name={lang === 'en' ? 'next' : 'back'} size={18} />
      </button>
    )
  }

  return createPortal(
    <div className="vw-overlay" role="dialog" aria-modal="true" aria-label={t.title}>
      <div className="vw-top">
        <button type="button" className="icon-btn vw-x" onClick={() => { shutdown(); onClose?.() }} aria-label={lang === 'en' ? 'Close' : 'إغلاق'}>
          <Icon name="close" size={18} />
        </button>
        <strong className="vw-title">{t.title}</strong>
        <button
          type="button"
          className={`vw-sound${voiceOn ? ' on' : ''}`}
          onClick={() => { if (voiceOn) stopSpeaking(); setVoiceOn((v) => !v) }}
          aria-pressed={voiceOn}
          aria-label={t.sound}
        >
          <Icon name="sound" size={17} />
        </button>
      </div>

      <div className="vw-body">
        {engine === 'typed' ? (
          <div className="vw-card vw-warn">
            <span className="vw-warn-ico"><Icon name="warning" size={22} /></span>
            <b>{t.unsupportedTitle}</b>
            <p className="vw-hint">{t.unsupportedHint}</p>
          </div>
        ) : (
          <div className="vw-mic-wrap">
            <button
              type="button"
              className={`vw-mic${phase === 'listening' ? ' live' : ''}${phase === 'thinking' ? ' busy' : ''}`}
              onClick={phase === 'listening'
                ? (engine === 'cloud' ? () => stopRecording() : () => { stopListening(); setPhase('idle') })
                : (engine === 'cloud' ? startCloud : startListening)}
              disabled={phase === 'thinking'}
              aria-label={micLabel}
            >
              <span className="vw-ring" aria-hidden="true" />
              <span className="vw-ring vw-ring-2" aria-hidden="true" />
              {engine === 'cloud' && phase === 'listening' && (
                <span className="vw-ring vw-ring-level" style={{ transform: `scale(${1 + level * 0.6})` }} aria-hidden="true" />
              )}
              <Icon name={phase === 'listening' ? 'stop' : 'mic'} size={34} />
            </button>
            <div className="vw-mic-label">{micLabel}</div>
            {phase === 'idle' && !say && <p className="vw-hint">{t.speakNow}</p>}
          </div>
        )}

        {(partial || heard) && (
          <div className="vw-transcript" dir="auto">
            <span className="vw-transcript-k">{t.heard}</span>
            <span>{partial || heard}</span>
          </div>
        )}

        {/* Everything spoken is mirrored here — never audio-only. */}
        <div className="vw-say" aria-live="polite" role="status">{say}</div>

        {phase === 'error' && (
          <div className="vw-card vw-warn">
            <span className="vw-warn-ico"><Icon name="warning" size={22} /></span>
            <b>{errText}</b>
            <button type="button" className="btn btn-primary btn-block" onClick={startListening}>{t.again}</button>
          </div>
        )}

        {phase === 'confirm' && pick && (
          <div className="vw-card vw-confirm">
            <div className="vw-confirm-head">
              {pick.item.imageUrl
                ? <img className="vw-confirm-img" src={pick.item.imageUrl} alt="" />
                : <span className="vw-confirm-img vw-choice-ph"><Icon name="coffee" size={22} /></span>}
              <div className="vw-confirm-txt">
                <b>{pickLang(pick.item, 'name', lang)}</b>
                {pick.variant && <span className="vw-hint">{pickLang(pick.variant, 'name', lang)}</span>}
                <span className="vw-confirm-price">
                  <Price value={((pick.variant ? pick.variant.price : pick.item.price) || 0) * pick.qty} currency={currency} lang={lang} />
                </span>
              </div>
            </div>
            {(pick.item.variants || []).length > 1 && (
              <div className="vw-vars">
                {pick.item.variants.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    className={`chip${pick.variant?.key === v.key ? ' active' : ''}`}
                    onClick={() => setPick((p) => ({ ...p, variant: v }))}
                  >
                    {pickLang(v, 'name', lang)}
                  </button>
                ))}
              </div>
            )}
            <div className="vw-qty">
              <Stepper value={pick.qty} onChange={(q) => setPick((p) => ({ ...p, qty: q }))} min={1} max={20} />
            </div>
            <div className="vw-actions">
              <button type="button" className="btn btn-ghost" onClick={() => { setPick(null); setPhase('idle'); setSay('') }}>{t.cancel}</button>
              <button type="button" className="btn btn-primary" onClick={confirmAdd}>{t.addIt}</button>
            </div>
          </div>
        )}

        {phase === 'choices' && choices.length > 0 && (
          <div className="vw-card">
            <b className="vw-choose-title">{t.choose}</b>
            <div className="vw-choices">
              {choices.map((c) => <ChoiceRow key={c.item.id} item={c.item} qty={c.qty} />)}
            </div>
          </div>
        )}

        {phase === 'confirm-multi' && multi.length > 0 && (
          <div className="vw-card">
            <b className="vw-choose-title">{t.multiTitle}</b>
            <div className="vw-multi">
              {multi.map((ln, i) => (
                <div key={`${ln.item.id}-${i}`} className="vw-multi-row">
                  {ln.item.imageUrl
                    ? <img className="vw-choice-img" src={ln.item.imageUrl} alt="" loading="lazy" />
                    : <span className="vw-choice-img vw-choice-ph"><Icon name="coffee" size={18} /></span>}
                  <span className="vw-multi-txt">
                    <b>{pickLang(ln.item, 'name', lang)}</b>
                    {ln.variant && <span className="vw-multi-note">{pickLang(ln.variant, 'name', lang)}</span>}
                    {ln.note && <span className="vw-multi-note">{ln.note}</span>}
                    {needsChoices(ln.item) && <span className="vw-multi-note">{t.needsTag}</span>}
                    <span><Price value={((ln.variant ? ln.variant.price : ln.item.price) || 0) * ln.qty} currency={currency} lang={lang} /></span>
                  </span>
                  <Stepper
                    value={ln.qty}
                    onChange={(q) => setMulti((m) => m.map((x, j) => (j === i ? { ...x, qty: q } : x)))}
                    min={AI_ORDER_RANGE.qty.min}
                    max={AI_ORDER_RANGE.qty.max}
                  />
                </div>
              ))}
            </div>
            <div className="vw-actions">
              <button type="button" className="btn btn-ghost" onClick={() => { setMulti([]); setPhase('idle'); setSay('') }}>{t.cancel}</button>
              <button type="button" className="btn btn-primary" onClick={addAllMulti}>{t.addAll} ({multi.length})</button>
            </div>
          </div>
        )}

        {phase === 'needs' && pick && (
          <div className="vw-card vw-confirm">
            <b>{pickLang(pick.item, 'name', lang)}</b>
            <p className="vw-hint">{say}</p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => { shutdown(); onOpenItem?.(pick.item); onClose?.() }}
            >
              {t.openItem}
            </button>
          </div>
        )}

        <form className="vw-typed" onSubmit={submitTyped}>
          <label className="vw-typed-lb" htmlFor="vw-typed-in">{t.typeInstead}</label>
          <div className="vw-typed-row">
            <input
              id="vw-typed-in"
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={t.speakNow}
              dir="auto"
              disabled={busy}
            />
            <button type="submit" className="btn btn-primary" disabled={!typed.trim() || busy}>{t.send}</button>
          </div>
        </form>
      </div>
    </div>,
    portalRoot,
  )
}
