import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { useToast } from '../components/Toast.jsx'
import Icon from '../components/Icon.jsx'
import MenuPreview from '../components/MenuPreview.jsx'
import { updateTenant, createTable, saveCategory } from '../lib/db.js'
import { uploadImage } from '../lib/storage.js'
import { SYSTEM_THEMES, glassVars, systemThemeAttr } from '../lib/systemThemes.js'

// First-run setup wizard: after registration the owner lands here —
// identity → numbers (tables/categories) → look & theme → activate.
// Every step persists immediately; "activate" stamps setupDone and opens
// the system in the chosen style. (The guided TOUR comes later, once all
// sections are final — deliberately deferred.)
const CAT_SUGGESTIONS = ['مشروبات ساخنة', 'مشروبات باردة', 'حلويات', 'وجبات', 'فطور', 'عصائر طازجة']

export default function Setup() {
  const { tenant, tenantId, updateTenantLocal } = useAuth()
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const toast = useToast()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  // step 1
  const [phone, setPhone] = useState(tenant?.phone || '')
  const [desc, setDesc] = useState(tenant?.descAr || '')
  const [uploading, setUploading] = useState(false)
  // step 2
  const [tablesN, setTablesN] = useState(6)
  const [cats, setCats] = useState(['مشروبات ساخنة', 'مشروبات باردة'])
  const [catInput, setCatInput] = useState('')
  const [seeded, setSeeded] = useState(false)

  if (tenant?.setupDone) return <Navigate to="/admin" replace />
  if (!tenant) return null

  const STEPS = [ar ? 'الهوية' : 'Identity', ar ? 'الأرقام' : 'Numbers', ar ? 'المظهر' : 'Look', ar ? 'التفعيل' : 'Activate']

  const persist = async (patch) => {
    try { await updateTenant(tenantId, patch); updateTenantLocal(patch) } catch (_) { toast.error(t('error')) }
  }

  const onLogo = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setUploading(true)
    try {
      const url = await uploadImage(tenantId, f, 'branding')
      await persist({ logoUrl: url })
    } catch (_) { toast.error(t('error')) } finally { setUploading(false) }
  }

  const next = async () => {
    if (step === 0) await persist({ phone: phone.trim(), descAr: desc.trim() })
    if (step === 1 && !seeded) {
      setBusy(true)
      try {
        await Promise.all([
          ...Array.from({ length: Math.min(40, Math.max(0, Number(tablesN) || 0)) }, (_, i) =>
            createTable(tenantId, { label: `${ar ? 'طاولة' : 'Table'} ${i + 1}`, seats: 4 })),
          ...cats.map((c, i) => saveCategory(tenantId, null, { nameAr: c, nameEn: '', sortOrder: i })),
        ])
        setSeeded(true)
      } catch (_) { toast.error(t('error')) } finally { setBusy(false) }
    }
    setStep((s) => Math.min(3, s + 1))
  }

  const activate = async () => {
    setBusy(true)
    try {
      await persist({ setupDone: true })
      toast.success(ar ? 'مبروك! منشأتك جاهزة' : 'Congrats — you are live')
      navigate('/admin', { replace: true })
    } finally { setBusy(false) }
  }

  return (
    <div className="setup-shell" data-systheme={systemThemeAttr(tenant, 'admin') || 'glass'} style={glassVars(tenant)}>
      <div className="setup-card">
        <div className="stack center" style={{ gap: 4, textAlign: 'center' }}>
          {tenant?.logoUrl ? <img src={tenant.logoUrl} alt="" style={{ width: 58, height: 58, borderRadius: '50%', objectFit: 'cover' }} /> : <Icon name="coffee" size={38} style={{ color: 'var(--brand)' }} />}
          <strong style={{ fontSize: 'var(--fs-lg)' }}>{tenant?.name}</strong>
          <span className="xs faint">{ar ? 'إعداد سريع — دقيقتان وتكون جاهزاً' : 'Quick setup — two minutes and you are live'}</span>
        </div>

        {/* steps indicator */}
        <div className="setup-steps">
          {STEPS.map((s, i) => (
            <div key={s} className={`setup-step ${i === step ? 'cur' : i < step ? 'done' : ''}`}>
              <span className="setup-dot">{i < step ? <Icon name="check" size={13} /> : i + 1}</span>
              <span className="xs">{s}</span>
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="stack" style={{ gap: 12 }}>
            <label className="btn btn-outline" style={{ cursor: 'pointer', alignSelf: 'center' }}>
              <Icon name="image" size={16} /> {uploading ? t('saving') : tenant?.logoUrl ? (ar ? 'تغيير الشعار' : 'Change logo') : (ar ? 'ارفع شعارك' : 'Upload logo')}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onLogo} disabled={uploading} />
            </label>
            <div className="field"><label>{ar ? 'رقم التواصل' : 'Phone'}</label>
              <input className="input num" dir="ltr" inputMode="tel" placeholder="05xxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div className="field"><label>{ar ? 'وصف قصير يظهر تحت الاسم في المنيو' : 'Short description (shown on the menu)'}</label>
              <input className="input" placeholder={ar ? 'قهوة مختصة وحلويات منزلية' : 'Specialty coffee & desserts'} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          </div>
        )}

        {step === 1 && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{ar ? `عدد الطاولات: ${tablesN}` : `Tables: ${tablesN}`} <span className="faint xs">({ar ? 'تُنشأ تلقائياً بأكواد QR' : 'auto-created with QR codes'})</span></label>
              <input type="range" min="0" max="30" value={tablesN} disabled={seeded} onChange={(e) => setTablesN(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{ar ? 'أقسام المنيو الأولية' : 'Initial menu categories'}</label>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {[...new Set([...CAT_SUGGESTIONS, ...cats])].map((c) => (
                  <button key={c} type="button" disabled={seeded} className={`chip ${cats.includes(c) ? 'active' : ''}`}
                    onClick={() => setCats((x) => x.includes(c) ? x.filter((y) => y !== c) : [...x, c])}>{c}</button>
                ))}
              </div>
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                <input className="input input-sm grow" placeholder={ar ? 'قسم آخر…' : 'Custom…'} value={catInput} disabled={seeded}
                  onChange={(e) => setCatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && catInput.trim()) { setCats((x) => [...new Set([...x, catInput.trim()])]); setCatInput('') } }} />
                <button className="btn btn-sm btn-outline" disabled={seeded || !catInput.trim()} onClick={() => { setCats((x) => [...new Set([...x, catInput.trim()])]); setCatInput('') }}>+</button>
              </div>
            </div>
            {seeded && <p className="xs" style={{ color: 'var(--success)', margin: 0 }}>✓ {ar ? 'أُنشئت الطاولات والأقسام' : 'Tables & categories created'}</p>}
          </div>
        )}

        {step === 2 && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{ar ? 'ثيم النظام (لوحتك والكاشير والمطبخ)' : 'System theme (dashboard, POS, KDS)'}</label>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {SYSTEM_THEMES.map((th) => (
                  <button key={th.id} type="button" className={`systheme-swatch ${(tenant?.systemTheme || 'classic') === th.id ? 'active' : ''}`} title={th.hintAr}
                    onClick={() => persist({ systemTheme: th.id })}>
                    <span className="systheme-dots">{th.swatch.map((c, i) => <span key={i} style={{ background: c }} />)}</span>
                    <span className="small bold">{ar ? th.ar : th.en}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="xs faint" style={{ margin: 0 }}>{ar ? 'منيو الزبائن له سكناته الخاصة — تخصصه بالكامل لاحقاً من: الإعدادات ← تصميم المظهر. هذه معاينته الحالية:' : 'The diner menu has its own skins (Appearance settings). Current preview:'}</p>
            {tenant?.slug && <MenuPreview slug={tenant.slug} mode="mobile" />}
          </div>
        )}

        {step === 3 && (
          <div className="stack" style={{ gap: 10 }}>
            {[
              [ar ? 'المنشأة' : 'Venue', tenant?.name],
              [ar ? 'رابط المنيو' : 'Menu link', `/m/${tenant?.slug || ''}`],
              [ar ? 'الطاولات والأقسام' : 'Tables & categories', seeded ? (ar ? 'جاهزة ✓' : 'Ready ✓') : (ar ? 'تخطيتها (تضاف لاحقاً)' : 'Skipped')],
              [ar ? 'ثيم النظام' : 'System theme', SYSTEM_THEMES.find((x) => x.id === (tenant?.systemTheme || 'classic'))?.[ar ? 'ar' : 'en']],
            ].map(([k, v]) => (
              <div key={k} className="row-between small"><span className="faint">{k}</span><span className="bold">{v}</span></div>
            ))}
            <p className="xs faint" style={{ margin: 0 }}>{ar ? 'كل شيء قابل للتعديل لاحقاً من الإعدادات. بالتفعيل تفتح لوحتك بالمظهر الذي اخترته.' : 'Everything stays editable. Activation opens your dashboard in the chosen style.'}</p>
          </div>
        )}

        <div className="row" style={{ gap: 8 }}>
          {step > 0 && <button className="btn btn-outline" disabled={busy} onClick={() => setStep((s) => s - 1)}>{ar ? 'السابق' : 'Back'}</button>}
          {step < 3
            ? <button className="btn btn-primary grow" disabled={busy || uploading} onClick={next}>{busy ? t('saving') : (ar ? 'التالي' : 'Next')}</button>
            : <button className="btn btn-success grow" style={{ fontWeight: 800 }} disabled={busy} onClick={activate}><Icon name="sparkles" size={17} /> {busy ? t('saving') : (ar ? 'تفعيل وفتح النظام' : 'Activate & open')}</button>}
        </div>
        {step < 3 && <button className="btn-link xs faint" style={{ alignSelf: 'center', background: 'none', border: 'none', cursor: 'pointer' }} onClick={activate}>{ar ? 'تخطي الإعداد وفتح النظام' : 'Skip setup'}</button>}
      </div>
    </div>
  )
}
