import { useState, useEffect } from 'react'
import { Link, useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { useToast } from '../components/Toast.jsx'
import { FullSpinner } from '../components/ui.jsx'
import BrandMark from '../components/BrandMark.jsx'
import { createTenant, findTenantByOwner, linkOwnerTenant } from '../lib/db.js'
import { seedSampleMenu } from '../lib/seed.js'
import { slugify } from '../lib/format.js'
import { THEMES, applyTheme } from '../lib/themes.js'
import { recordLegalConsent, REQUIRED_CONSENT, CONSENT_VERSION } from '../lib/legal.js'

import Icon from '../components/Icon.jsx'
import { VENUE_TYPES } from '../lib/venueTypes.js'
// The platform identity — the same stylesheet the landing and the auth screens
// use. Signup and setup are one continuous flow and must look like one.
import '../landing.css'

const CURRENCIES = ['SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'EGP', 'USD']

// The checklist tells the owner what each step is FOR. Three numbered circles
// labelled «الهوية / المظهر / الانطلاق» name the steps without explaining any
// of them; a setup wizard's job is to make the remaining work feel known.
const STEPS = [
  { key: 'identity', icon: 'store', ar: 'الهوية', en: 'Identity', subAr: 'الاسم والرابط ونوع النشاط والعملة', subEn: 'Name, link, activity and currency' },
  { key: 'look', icon: 'palette', ar: 'المظهر', en: 'Look', subAr: 'ألوان منشأتك كما يراها ضيوفك', subEn: 'Your colours, as guests will see them' },
  { key: 'launch', icon: 'zap', ar: 'الانطلاق', en: 'Launch', subAr: 'مراجعة أخيرة ثم إنشاء المنشأة', subEn: 'A last look, then create' },
]

// What the platform actually ships with — shown on the last step.
const FEATURES = [
  { icon: 'cashier', ar: 'كاشير ومطبخ لحظي', en: 'Live cashier & kitchen screens' },
  { icon: 'award', ar: 'عضويات VIP وبطاقات رقمية', en: 'VIP memberships & digital cards' },
  { icon: 'message', ar: 'حملات واتساب لعملائك', en: 'WhatsApp campaigns for your customers' },
  { icon: 'receipt', ar: 'فواتير متوافقة مع ZATCA', en: 'ZATCA-compliant invoices' },
  { icon: 'sparkles', ar: 'مساعد ذكي يدير نظامك معك', en: 'An AI assistant that runs the system with you' },
]

export default function Onboarding() {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const { user, tenantId, refreshProfile, loading, isPlatformAdmin } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  // Draft survives refresh/accidental navigation — the owner NEVER re-types.
  // Priority: saved draft → landing "try now" prefill → blank.
  const draft = (() => { try { return JSON.parse(sessionStorage.getItem('rbt_onb_draft') || 'null') || {} } catch (_) { return {} } })()
  const [name, setName] = useState(() => { try { return draft.name || sessionStorage.getItem('rbt_prefill_venue') || '' } catch (_) { return draft.name || '' } })
  const [slug, setSlug] = useState(draft.slug || '')
  const [slugTouched, setSlugTouched] = useState(!!draft.slugTouched)
  const [type, setType] = useState(draft.type || 'cafe')
  const [typeLabel, setTypeLabel] = useState(draft.typeLabel || '')
  const [currency, setCurrency] = useState(draft.currency || 'SAR')
  const [preset, setPreset] = useState(draft.preset || 'maroon')
  const [color, setColor] = useState(draft.color || '#7c2d2d')
  const [accent, setAccent] = useState(draft.accent || '#5c5c66')
  const [seed, setSeed] = useState(true)
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(1)
  const [recovering, setRecovering] = useState(true)

  // Consume the landing prefill exactly once so a later, different signup
  // never inherits stale venue data from this browser session.
  useEffect(() => {
    try {
      sessionStorage.removeItem('rbt_prefill_venue')
      sessionStorage.removeItem('rbt_prefill_phone')
    } catch (_) { /* ignore */ }
  }, [])

  // ORPHAN RECOVERY: if a venue already exists with this user as owner but the
  // profile lost its link (historic partial creations), re-link and go straight
  // in — never ask the owner to re-enter their venue from scratch.
  useEffect(() => {
    let alive = true
    if (loading || !user || tenantId) { setRecovering(false); return undefined }
    findTenantByOwner(user.uid)
      .then(async (t) => {
        if (!alive) return
        if (t) {
          await linkOwnerTenant(user.uid, t.id)
          await refreshProfile()
          toast.success(ar ? `وجدنا منشأتك «${t.name || ''}» — أهلاً بعودتك` : `Found your venue "${t.name || ''}" — welcome back`)
          navigate('/admin', { replace: true })
        } else {
          setRecovering(false)
        }
      })
      .catch(() => { if (alive) setRecovering(false) })
    return () => { alive = false }
  }, [loading, user, tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name))
  }, [name, slugTouched])

  // Persist the draft on every change (cleared on successful creation).
  useEffect(() => {
    try { sessionStorage.setItem('rbt_onb_draft', JSON.stringify({ name, slug, slugTouched, type, typeLabel, currency, preset, color, accent })) } catch (_) { /* ignore */ }
  }, [name, slug, slugTouched, type, typeLabel, currency, preset, color, accent])

  if (loading || recovering) return <FullSpinner />
  if (!user) return <Navigate to="/login" replace />
  if (tenantId && !busy) return <Navigate to="/admin" replace />

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    if (!agreed) { toast.error(lang === 'ar' ? 'يجب الموافقة على الشروط وسياسة الخصوصية' : 'You must accept the Terms & Privacy') ; return }
    setBusy(true)
    try {
      // Double-create guard: a rapid retry / second tab must never mint a second
      // venue for the same owner — link the existing one instead.
      const existing = await findTenantByOwner(user.uid).catch(() => null)
      if (existing) {
        await linkOwnerTenant(user.uid, existing.id)
        await refreshProfile()
        toast.success(ar ? 'منشأتك موجودة مسبقاً — تم الدخول إليها' : 'Your venue already exists — signed in')
        navigate('/admin', { replace: true })
        return
      }
      const res = await createTenant(user.uid, {
        name: name.trim(),
        type,
        typeLabel: type === 'other' ? typeLabel.trim() : '',
        slug: slug.trim(),
        currency,
        themeColor: color,
        themeAccent: accent,
        themePreset: preset,
      })
      // Record the venue's acceptance of the legal terms (versioned).
      recordLegalConsent({ tenantId: res.id, uid: user.uid, byName: user.displayName || user.email || '', docs: REQUIRED_CONSENT, version: CONSENT_VERSION })
      if (seed) {
        try {
          await seedSampleMenu(res.id)
        } catch (_) {
          /* non-fatal */
        }
      }
      await refreshProfile()
      try { sessionStorage.removeItem('rbt_onb_draft') } catch (_) { /* ignore */ }
      toast.success(t('saved'))
      // replace: browser-back must never land on a stale creation form.
      // Signup → plan choice (pay now or start the full trial) → guided setup.
      navigate('/choose-plan', { replace: true })
    } catch (err) {
      const code = err?.code || err?.message || ''
      toast.error(
        code.includes('permission') ? (ar ? 'رفض من الخادم — حدّث الصفحة وحاول مجدداً، وإن تكرر تواصل مع الدعم' : 'Server denied — refresh and retry; contact support if it persists')
          : code.includes('slug') ? (ar ? 'الرابط المختصر محجوز — جرّب اسماً مختلفاً' : 'That link is taken — try another')
          : code.includes('network') || code.includes('unavailable') ? (ar ? 'تحقق من اتصالك بالإنترنت ثم أعد المحاولة' : 'Check your connection and retry')
          : (ar ? 'تعذّر الإنشاء، حاول مجدداً' : 'Could not create, try again'),
      )
      setBusy(false)
    }
  }

  const next = () => {
    if (step === 1 && !name.trim()) {
      toast.error(ar ? 'اكتب اسم المنشأة أولاً' : 'Enter the venue name first')
      return
    }
    setStep((s) => Math.min(3, s + 1))
  }

  const onFormSubmit = (e) => {
    if (step < 3) { e.preventDefault(); next(); return }
    submit(e)
  }

  const stepMeta = STEPS[step - 1]

  return (
    <div className="onb" dir={ar ? 'rtl' : 'ltr'}>
      {/* ---- the brief: what this is, and what is left to do ---- */}
      <aside className="onb-aside">
        <BrandMark size={30} mono />
        <div>
          <div className="onb-aside-h">{t('createVenue')}</div>
          <p className="onb-aside-p">{t('onboardingIntro')}</p>
        </div>

        <ol className="onb-steps" aria-label={ar ? 'خطوات الإنشاء' : 'Setup steps'}>
          {STEPS.map((s, i) => {
            const n = i + 1
            const state = n < step ? 'done' : n === step ? 'on' : ''
            return (
              <li key={s.key} className={`onb-step ${state} ${n <= step ? 'lit' : ''}`}>
                <button
                  type="button"
                  className="onb-step-dot"
                  onClick={() => { if (n < step) setStep(n) }}
                  disabled={n > step}
                  aria-current={n === step ? 'step' : undefined}
                  aria-label={ar ? s.ar : s.en}
                >
                  {n < step ? <Icon name="check" size={14} /> : n}
                </button>
                <span className="onb-step-txt">
                  <span className="onb-step-lbl">{ar ? s.ar : s.en}</span>
                  <span className="onb-step-sub">{ar ? s.subAr : s.subEn}</span>
                </span>
              </li>
            )
          })}
        </ol>

        <p className="onb-aside-foot">
          {ar ? 'يمكنك تغيير كل ما تختاره هنا لاحقاً من إعدادات منشأتك.' : 'Everything chosen here can be changed later from your settings.'}
        </p>
      </aside>

      {/* ---- the form ---- */}
      <main className="onb-main">
        <form className="onb-form" onSubmit={onFormSubmit}>
          <div className="onb-top">
            <div>
              <h1 className="onb-h">{ar ? stepMeta.ar : stepMeta.en}</h1>
              <p>{ar ? stepMeta.subAr : stepMeta.subEn}</p>
            </div>
            <span className="onb-count" dir="ltr">{step} / {STEPS.length}</span>
          </div>

          {isPlatformAdmin && (
            <Link to="/platform" className="onb-admin">
              <Icon name="sparkles" size={15} />
              {ar ? 'أنت مدير المنصة — الدخول إلى لوحة المنصّة' : 'You are a platform admin — open the console'}
            </Link>
          )}

          {step === 1 && (
            <div className="onb-panel">
              <div className="onb-field">
                <label htmlFor="onb-name">{t('venueName')}</label>
                <input id="onb-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={ar ? 'مثال: مقهى الرصيف' : 'e.g. Rasif Coffee'} autoFocus />
              </div>

              <div className="onb-field">
                <label htmlFor="onb-slug">{t('venueSlug')}</label>
                {/* the prefix is welded to the field so the shape of the final
                    address is visible while it is being typed */}
                <div className="onb-slug">
                  <span dir="ltr">/m/</span>
                  <input
                    id="onb-slug"
                    className="input"
                    dir="ltr"
                    value={slug}
                    onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)) }}
                    placeholder="rasif-coffee"
                  />
                </div>
                <span className="onb-hint">{t('slugHint')}</span>
              </div>

              {/* Venue type drives the whole system's vocabulary and the AI's
                  understanding of the business — so it is chosen up front, from
                  the full catalogue, with a free-text path for anything new. */}
              <div className="onb-field">
                <label>{t('venueType')}</label>
                <div className="onb-chips">
                  {VENUE_TYPES.map((ty) => (
                    <button type="button" key={ty.id} onClick={() => setType(ty.id)} className={`onb-chip ${type === ty.id ? 'on' : ''}`} aria-pressed={type === ty.id}>
                      <Icon name={ty.icon} size={13} /> {ty.ar}
                    </button>
                  ))}
                </div>
                {type === 'other' && (
                  <input
                    className="input"
                    style={{ marginTop: 8 }}
                    placeholder="اكتب نوع نشاطك (مثال: محمصة بن، محل شوكولاتة)"
                    value={typeLabel}
                    onChange={(e) => setTypeLabel(e.target.value)}
                  />
                )}
                <span className="onb-hint">يضبط النظام مفرداته على نشاطك — «مشروب» أو «طبق» أو «منتج» — ويستخدمها الذكاء في كل ما يكتبه ويصممه لك.</span>
              </div>

              <div className="onb-field">
                <label htmlFor="onb-cur">{t('currency')}</label>
                <select id="onb-cur" className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="onb-panel">
              <div className="onb-field">
                <label>{t('theme')}</label>
                <div className="onb-chips">
                  {THEMES.map((th) => (
                    <button type="button" key={th.id} className={`onb-chip ${preset === th.id ? 'on' : ''}`} aria-pressed={preset === th.id}
                      onClick={() => { setPreset(th.id); setColor(th.brand); setAccent(th.accent); applyTheme({ brand: th.brand, accent: th.accent }) }}>
                      <span className="sw" style={{ background: th.brand }} />
                      {th.name[lang] || th.name.ar}
                    </button>
                  ))}
                </div>
              </div>

              <div className="onb-picks">
                <label className="onb-pick">
                  <input type="color" value={color} onChange={(e) => { setColor(e.target.value); applyTheme({ brand: e.target.value, accent }) }} />
                  <span>{ar ? 'اللون الأساسي' : 'Brand color'}</span>
                </label>
                <label className="onb-pick">
                  <input type="color" value={accent} onChange={(e) => { setAccent(e.target.value); applyTheme({ brand: color, accent: e.target.value }) }} />
                  <span>{ar ? 'اللون الثانوي' : 'Accent color'}</span>
                </label>
              </div>

              {/* The ONLY place the venue's colours appear. The wizard's own
                  chrome stays on the platform palette — a setup flow that
                  repaints itself as you click through it is disorienting, and
                  it also blurs whose brand is whose. */}
              <div className="onb-field">
                <label>{ar ? 'هكذا سيراها ضيوفك' : 'How your guests will see it'}</label>
                <div className="onb-preview" aria-hidden="true">
                  <div className="onb-preview-top" style={{ background: color }}>
                    <span className="onb-preview-logo" />
                    <span className="onb-preview-name">{name.trim() || (ar ? 'منشأتك' : 'Your venue')}</span>
                  </div>
                  <div className="onb-preview-body">
                    <div className="onb-preview-chips">
                      <span className="onb-preview-chip" style={{ background: color }}>{ar ? 'الأصناف' : 'Items'}</span>
                      <span className="onb-preview-chip is-ghost" style={{ color: accent, borderColor: accent }}>{ar ? 'العروض' : 'Offers'}</span>
                    </div>
                    <span className="onb-preview-line" style={{ width: '72%' }} />
                    <span className="onb-preview-line" style={{ width: '48%' }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="onb-panel">
              <div className="onb-field">
                <label>{ar ? 'ماذا جهّزنا لك' : 'What we prepared for you'}</label>
                <ul className="onb-feats">
                  {FEATURES.map((f) => (
                    <li key={f.icon} className="onb-feat">
                      <Icon name={f.icon} size={16} className="ic" />
                      <span>{ar ? f.ar : f.en}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <label className="onb-check">
                <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
                <span>{ar ? 'إضافة منيو تجريبي للبدء بسرعة' : 'Add a sample menu to start quickly'}</span>
              </label>

              <label className="onb-check">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>
                  {ar ? 'أوافق على ' : 'I accept the '}
                  <a href="/legal/terms" target="_blank" rel="noreferrer">{ar ? 'الشروط والأحكام' : 'Terms'}</a>
                  {ar ? ' و' : ' & '}
                  <a href="/legal/privacy" target="_blank" rel="noreferrer">{ar ? 'سياسة الخصوصية' : 'Privacy Policy'}</a>
                </span>
              </label>
            </div>
          )}

          <div className="onb-nav">
            {step > 1 && (
              <button type="button" className="onb-btn ghost" onClick={() => setStep(step - 1)} disabled={busy}>
                <Icon name="back" size={15} />
                {ar ? 'رجوع' : 'Back'}
              </button>
            )}
            {step < 3 ? (
              <button type="submit" className="onb-btn grow">
                {ar ? 'التالي' : 'Next'}
                <Icon name="next" size={15} />
              </button>
            ) : (
              <button type="submit" className="onb-btn grow" disabled={busy || !agreed}>
                {busy ? t('saving') : t('createVenueCta')}
              </button>
            )}
          </div>
        </form>
      </main>
    </div>
  )
}
