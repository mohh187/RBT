import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePortalRoot } from './PortalRoot.jsx'
import { pickLang } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'
import { Stepper } from './ui.jsx'
import { Price } from './Riyal.jsx'
import {
  speechSupported, speechAvailable, listenOnce, stopListening, speak, stopSpeaking,
  speechErrorText, matchItems, parseQty, parseIntent, pickVariant, needsChoices, priceSpeech,
} from '../lib/voiceOrder.js'

// «النادل الصوتي» — the guest speaks, we match locally (no AI round-trip) and
// confirm before anything reaches the cart. Every spoken line is ALSO rendered
// as text: this is never an audio-only interface.
//
// Deliberate guardrails:
//  • We never guess a required modifier — the item sheet is opened instead.
//  • One clear winner is required to auto-confirm; otherwise the guest picks.
//  • Unsupported browsers (Firefox) get a typed fallback, not a dead mic.

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
  },
}

export default function VoiceWaiter({ open, onClose, items = [], lang = 'ar', currency = 'SAR', onAdd, onOpenItem }) {
  const portalRoot = usePortalRoot()
  const t = COPY[lang === 'en' ? 'en' : 'ar']
  const speechLang = lang === 'en' ? 'en-US' : 'ar-SA'
  const supported = speechSupported()

  const [phase, setPhase] = useState('idle') // idle | listening | thinking | confirm | choices | none | needs | error
  const [partial, setPartial] = useState('')
  const [heard, setHeard] = useState('')
  const [say, setSay] = useState('')
  const [pick, setPick] = useState(null) // { item, variant, qty }
  const [choices, setChoices] = useState([])
  const [errText, setErrText] = useState('')
  const [voiceOn, setVoiceOn] = useState(true)
  const [typed, setTyped] = useState('')

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
    setPick(null); setChoices([]); setErrText(''); setTyped('')
  }

  // Hard stop: dangling recognition/speech after close is a real, reported bug.
  const shutdown = () => {
    stopListening()
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
  const commit = (item, qty, sourceText = '') => {
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
    const variant = pickVariant(sourceText, item)
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
    setErrText(''); setSay(''); setHeard(''); setPartial(''); setPick(null); setChoices([])
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
        {!supported ? (
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
              onClick={phase === 'listening' ? () => { stopListening(); setPhase('idle') } : startListening}
              disabled={phase === 'thinking'}
              aria-label={micLabel}
            >
              <span className="vw-ring" aria-hidden="true" />
              <span className="vw-ring vw-ring-2" aria-hidden="true" />
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
