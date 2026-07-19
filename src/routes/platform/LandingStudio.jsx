// Platform console — Landing Studio (/platform/landing). Full CMS control over
// the public landing page: section visibility + order, every text/bullet/FAQ,
// pricing-tier marketing copy (with an explicit priceOverride escape hatch —
// checkout prices are ALWAYS server-derived), announcement ribbon, footer,
// socials, theme accent and the floating WhatsApp button.
// Saves the FULL merged object to platformConfig/landing (merge:false).
import { useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Spinner } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { db } from '../../lib/firebase.js'
import { doc, setDoc } from 'firebase/firestore'
import { mergeLanding, watchLanding, SECTION_META } from '../../lib/landingContent.js'
import { PLANS, PLAN_PRICES, YEARLY_DISCOUNT } from '../../lib/plans.js'

const TABS = [
  ...SECTION_META,
  { key: 'footer', ar: 'التذييل', icon: 'list' },
  { key: 'theme', ar: 'المظهر', icon: 'palette' },
  { key: 'whatsappFloat', ar: 'زر واتساب', icon: 'message' },
]

const VISUAL_OPTIONS = [
  { id: 'menu', ar: 'معاينة المنيو والثيمات' },
  { id: 'ops', ar: 'لوحة الطلبات (كاشير/مطبخ)' },
  { id: 'ai', ar: 'المخزون + المساعد الذكي' },
  { id: 'signage', ar: 'شاشة العرض' },
  { id: 'flow', ar: 'مخطط تدفق الطلب' },
  { id: '', ar: 'أيقونة فقط' },
]

export default function LandingStudio() {
  const toast = useToast()
  const [base, setBase] = useState(null) // merged published content
  const [draft, setDraft] = useState(null)
  const [tab, setTab] = useState('hero')
  const [busy, setBusy] = useState(false)
  const [previewN, setPreviewN] = useState(0)
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => watchLanding(db, (merged) => {
    setBase(merged)
    setDraft((d) => (d === null ? structuredClone(merged) : d))
  }), [])

  const dirty = useMemo(() => {
    if (!draft || !base) return false
    return JSON.stringify(draft) !== JSON.stringify(base)
  }, [draft, base])

  if (!draft || !base) return <Spinner />

  // Immutable-enough updater: clone, mutate, set. Keeps every form terse.
  const upd = (fn) => setDraft((d) => { const nd = structuredClone(d); fn(nd); return nd })
  const moveIn = (arr, i, dir) => { const j = i + dir; if (j >= 0 && j < arr.length) { const t = arr[i]; arr[i] = arr[j]; arr[j] = t } }

  const save = async () => {
    setBusy(true)
    try {
      await setDoc(doc(db, 'platformConfig', 'landing'), draft, { merge: false })
      toast.success('نُشرت الصفحة — التغييرات مباشرة الآن')
    } catch {
      toast.error('تعذّر النشر — تحقق من صلاحياتك')
    } finally {
      setBusy(false)
    }
  }
  const discard = () => setDraft(structuredClone(base))
  const resetDefaults = () => {
    if (!window.confirm('استعادة كل محتوى الصفحة إلى الافتراضي؟ (لن يُنشر حتى تضغط «نشر»)')) return
    setDraft(mergeLanding({}))
  }

  const secRow = (key) => draft.sections.find((s) => s.key === key)

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)', paddingBottom: 90 }}>
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
        <div>
          <h1 className="page-title"><Icon name="penLine" size={20} /> استوديو صفحة الهبوط</h1>
          <p className="muted small">تحكّم كامل بمحتوى الصفحة العامة — الافتراضي يُعرض دائماً حتى قبل أول نشر.</p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={() => setShowPreview((v) => !v)}>
            <Icon name="eye" size={15} /> {showPreview ? 'إخفاء المعاينة' : 'معاينة حية'}
          </button>
          <a href="/" target="_blank" rel="noreferrer" className="btn btn-outline"><Icon name="share" size={15} /> فتح الصفحة</a>
          <button className="btn btn-outline" onClick={resetDefaults}><Icon name="undo" size={15} /> استعادة الافتراضي</button>
        </div>
      </div>

      {showPreview && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="row-between" style={{ padding: 'var(--sp-2) var(--sp-3)', borderBottom: '1px solid var(--border)' }}>
            <span className="small bold"><Icon name="eye" size={14} /> معاينة — تعرض النسخة المنشورة، احفظ أولاً لرؤية تعديلاتك</span>
            <button className="btn btn-outline btn-xs" onClick={() => setPreviewN((n) => n + 1)}><Icon name="reload" size={13} /> تحديث</button>
          </div>
          <iframe key={previewN} src="/" title="معاينة صفحة الهبوط" style={{ width: '100%', height: 560, border: 0, display: 'block', background: '#fff' }} />
        </div>
      )}

      {/* section order + visibility */}
      <div className="card card-pad">
        <div className="row" style={{ gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
          <Icon name="arrowUpDown" size={18} />
          <div>
            <div className="bold">أقسام الصفحة — الترتيب والظهور</div>
            <div className="small muted">فعّل أو أخفِ أي قسم وأعد ترتيبه. شريط الإعلان يظهر دائماً أعلى الصفحة عند تفعيله.</div>
          </div>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          {draft.sections.map((s, i) => {
            const meta = SECTION_META.find((m) => m.key === s.key) || { ar: s.key, icon: 'grid' }
            return (
              <div key={s.key} className="row" style={{ gap: 8, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface)' }}>
                <Icon name={meta.icon} size={16} style={{ color: 'var(--text-faint)', flex: 'none' }} />
                <button className="grow" style={{ textAlign: 'start', background: 'none', border: 0, cursor: 'pointer', color: 'var(--text)', fontWeight: 600, fontFamily: 'inherit', fontSize: 'inherit', padding: 0 }} onClick={() => setTab(s.key)}>
                  {meta.ar}
                </button>
                <button className="btn btn-outline btn-xs" disabled={i === 0} onClick={() => upd((d) => moveIn(d.sections, i, -1))} title="أعلى"><Icon name="arrowUp" size={13} /></button>
                <button className="btn btn-outline btn-xs" disabled={i === draft.sections.length - 1} onClick={() => upd((d) => moveIn(d.sections, i, 1))} title="أسفل"><Icon name="arrowUp" size={13} style={{ transform: 'rotate(180deg)' }} /></button>
                <Switch on={s.enabled !== false} onChange={(v) => upd((d) => { d.sections[i].enabled = v })} />
              </div>
            )
          })}
        </div>
      </div>

      {/* editor tabs */}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} size={14} /> {t.ar}
          </button>
        ))}
      </div>

      {tab === 'announcement' && (
        <Card title="شريط الإعلان" icon="bellRing">
          <Switch on={draft.announcement.enabled} onChange={(v) => upd((d) => { d.announcement.enabled = v })} label="إظهار الشريط" wide />
          <TxtIn label="النص" value={draft.announcement.text} onChange={(v) => upd((d) => { d.announcement.text = v })} />
          <TxtIn label="الرابط عند الضغط (اختياري)" value={draft.announcement.href} onChange={(v) => upd((d) => { d.announcement.href = v })} dir="ltr" placeholder="/signup" />
        </Card>
      )}

      {tab === 'hero' && (
        <Card title="الواجهة الرئيسية" icon="flame">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <TxtIn label="العنوان" value={draft.hero.title} onChange={(v) => upd((d) => { d.hero.title = v })} grow />
            <TxtIn label="الجزء الملوّن من العنوان" value={draft.hero.titleAccent} onChange={(v) => upd((d) => { d.hero.titleAccent = v })} grow />
          </div>
          <AreaIn label="النص التعريفي" value={draft.hero.subtitle} onChange={(v) => upd((d) => { d.hero.subtitle = v })} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <TxtIn label="نص الزر الرئيسي" value={draft.hero.ctaText} onChange={(v) => upd((d) => { d.hero.ctaText = v })} grow />
            <TxtIn label="رابطه" value={draft.hero.ctaHref} onChange={(v) => upd((d) => { d.hero.ctaHref = v })} dir="ltr" grow />
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <TxtIn label="نص الزر الثانوي" value={draft.hero.secondaryText} onChange={(v) => upd((d) => { d.hero.secondaryText = v })} grow />
            <TxtIn label="رابطه" value={draft.hero.secondaryHref} onChange={(v) => upd((d) => { d.hero.secondaryHref = v })} dir="ltr" grow />
          </div>
          <Lines label="شارات الثقة (سطر لكل شارة)" value={draft.hero.badges} onChange={(v) => upd((d) => { d.hero.badges = v })} />
        </Card>
      )}

      {tab === 'logos' && (
        <Card title="شريط العملاء (شرائح نصية متحركة)" icon="store">
          <Switch on={draft.logos.enabled} onChange={(v) => upd((d) => { d.logos.enabled = v })} label="إظهار الشريط" wide />
          <TxtIn label="العنوان فوق الشريط" value={draft.logos.title} onChange={(v) => upd((d) => { d.logos.title = v })} />
          <div className="xs faint">أسماء نصية فقط — لا شعارات مزيفة. أضف عملاءك الحقيقيين ثم فعّل الشريط.</div>
          {draft.logos.items.map((it, i) => (
            <div key={i} className="row" style={{ gap: 6 }}>
              <input className="input grow" value={it.name} onChange={(e) => upd((d) => { d.logos.items[i].name = e.target.value })} placeholder="اسم المنشأة" />
              <RowTools onUp={() => upd((d) => moveIn(d.logos.items, i, -1))} onDown={() => upd((d) => moveIn(d.logos.items, i, 1))} onDel={() => upd((d) => { d.logos.items.splice(i, 1) })} />
            </div>
          ))}
          <button className="btn btn-outline btn-sm" onClick={() => upd((d) => { d.logos.items.push({ name: '' }) })}><Icon name="add" size={14} /> إضافة اسم</button>
        </Card>
      )}

      {tab === 'features' && (
        <Card title="شبكة المزايا" icon="grid">
          <TxtIn label="العنوان" value={draft.features.title} onChange={(v) => upd((d) => { d.features.title = v })} />
          <TxtIn label="النص الفرعي" value={draft.features.subtitle} onChange={(v) => upd((d) => { d.features.subtitle = v })} />
          {draft.features.items.map((it, i) => (
            <div key={i} className="card card-pad stack" style={{ gap: 6, background: 'var(--surface-2)' }}>
              <div className="row" style={{ gap: 6 }}>
                <input className="input" style={{ width: 120 }} dir="ltr" value={it.icon} onChange={(e) => upd((d) => { d.features.items[i].icon = e.target.value })} placeholder="icon" title="اسم الأيقونة من Icon.jsx" />
                <input className="input grow" value={it.title} onChange={(e) => upd((d) => { d.features.items[i].title = e.target.value })} placeholder="عنوان الميزة" />
                <RowTools onUp={() => upd((d) => moveIn(d.features.items, i, -1))} onDown={() => upd((d) => moveIn(d.features.items, i, 1))} onDel={() => upd((d) => { d.features.items.splice(i, 1) })} />
              </div>
              <textarea className="input" rows={2} value={it.desc} onChange={(e) => upd((d) => { d.features.items[i].desc = e.target.value })} placeholder="الوصف" />
            </div>
          ))}
          <button className="btn btn-outline btn-sm" onClick={() => upd((d) => { d.features.items.push({ icon: 'star', title: '', desc: '' }) })}><Icon name="add" size={14} /> إضافة ميزة</button>
          <div className="xs faint">اسم الأيقونة إنجليزي من قائمة أيقونات النظام (مثل qr, cashier, sparkles, award...).</div>
        </Card>
      )}

      {tab === 'showcase' && (
        <Card title="أقسام العرض المتعرّجة" icon="layers">
          {draft.showcase.map((s, i) => (
            <div key={i} className="card card-pad stack" style={{ gap: 6, background: 'var(--surface-2)' }}>
              <div className="row" style={{ gap: 6 }}>
                <input className="input grow" value={s.title} onChange={(e) => upd((d) => { d.showcase[i].title = e.target.value })} placeholder="العنوان" />
                <RowTools onUp={() => upd((d) => moveIn(d.showcase, i, -1))} onDown={() => upd((d) => moveIn(d.showcase, i, 1))} onDel={() => upd((d) => { d.showcase.splice(i, 1) })} />
              </div>
              <textarea className="input" rows={2} value={s.desc} onChange={(e) => upd((d) => { d.showcase[i].desc = e.target.value })} placeholder="الوصف" />
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input className="input" style={{ width: 120 }} dir="ltr" value={s.icon} onChange={(e) => upd((d) => { d.showcase[i].icon = e.target.value })} placeholder="icon" />
                <select className="input" style={{ width: 220 }} value={s.visual || ''} onChange={(e) => upd((d) => { d.showcase[i].visual = e.target.value })}>
                  {VISUAL_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.ar}</option>)}
                </select>
                <Switch on={!!s.flip} onChange={(v) => upd((d) => { d.showcase[i].flip = v })} label="عكس الاتجاه" />
              </div>
              <Lines label="النقاط (سطر لكل نقطة)" value={s.bullets} onChange={(v) => upd((d) => { d.showcase[i].bullets = v })} />
            </div>
          ))}
          <button className="btn btn-outline btn-sm" onClick={() => upd((d) => { d.showcase.push({ title: '', desc: '', icon: 'star', flip: d.showcase.length % 2 === 1, visual: '', bullets: [] }) })}><Icon name="add" size={14} /> إضافة قسم</button>
        </Card>
      )}

      {tab === 'stats' && (
        <Card title="شريط الأرقام" icon="chartBar">
          <Switch on={draft.stats.enabled} onChange={(v) => upd((d) => { d.stats.enabled = v })} label="إظهار الأرقام" wide />
          <div className="xs faint">أرقام صادقة فقط — لا تختلق أعداد عملاء. أرقام عامة عن النظام نفسه مقبولة.</div>
          {draft.stats.items.map((it, i) => (
            <div key={i} className="row" style={{ gap: 6 }}>
              <input className="input num" style={{ width: 110 }} dir="ltr" value={it.value} onChange={(e) => upd((d) => { d.stats.items[i].value = e.target.value })} placeholder="0%" />
              <input className="input grow" value={it.label} onChange={(e) => upd((d) => { d.stats.items[i].label = e.target.value })} placeholder="الوصف" />
              <RowTools onUp={() => upd((d) => moveIn(d.stats.items, i, -1))} onDown={() => upd((d) => moveIn(d.stats.items, i, 1))} onDel={() => upd((d) => { d.stats.items.splice(i, 1) })} />
            </div>
          ))}
          <button className="btn btn-outline btn-sm" onClick={() => upd((d) => { d.stats.items.push({ value: '', label: '' }) })}><Icon name="add" size={14} /> إضافة رقم</button>
        </Card>
      )}

      {tab === 'pricing' && (
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <div className="card card-pad" style={{ borderColor: 'var(--warning)' }}>
            <p className="small">
              <Icon name="warning" size={14} style={{ verticalAlign: 'middle', color: 'var(--warning)' }} /> الأسعار المعروضة تأتي تلقائياً من <code>src/lib/plans.js</code> (خصم سنوي {Math.round((1 - YEARLY_DISCOUNT) * 100)}%). «تجاوز السعر» يغيّر العرض فقط — سعر الدفع الفعلي يُحتسب دائماً من الخادم عند الاشتراك.
            </p>
          </div>
          <Card title="نصوص قسم الباقات" icon="wallet">
            <TxtIn label="العنوان" value={draft.pricing.title} onChange={(v) => upd((d) => { d.pricing.title = v })} />
            <TxtIn label="النص الفرعي" value={draft.pricing.subtitle} onChange={(v) => upd((d) => { d.pricing.subtitle = v })} />
            <AreaIn label="ملاحظة أسفل الباقات" value={draft.pricing.note} onChange={(v) => upd((d) => { d.pricing.note = v })} rows={2} />
          </Card>
          {PLANS.map((p) => {
            const t = draft.pricing.tiers[p.id] || {}
            const patch = (fn) => upd((d) => { if (!d.pricing.tiers[p.id]) d.pricing.tiers[p.id] = {}; fn(d.pricing.tiers[p.id]) })
            return (
              <Card key={p.id} title={`باقة «${p.ar}» — السعر من الخادم: ${PLAN_PRICES[p.id]} ر.س/شهر`} icon="wallet">
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <TxtIn label="السطر التسويقي" value={t.tagline || ''} onChange={(v) => patch((x) => { x.tagline = v })} grow />
                  <TxtIn label="شارة أعلى البطاقة" value={t.badge || ''} onChange={(v) => patch((x) => { x.badge = v })} grow placeholder="الأكثر اختياراً" />
                </div>
                <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Switch on={!!t.highlight} onChange={(v) => patch((x) => { x.highlight = v })} label="بطاقة مميزة" />
                  <Switch on={!!t.glow} onChange={(v) => patch((x) => { x.glow = v })} label="توهّج ذهبي" />
                  <label className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <span className="xs faint bold">تجاوز السعر (اختياري)</span>
                    <input
                      className="input num" style={{ width: 100 }} dir="ltr" type="number" min="0"
                      value={t.priceOverride ?? ''}
                      onChange={(e) => patch((x) => { x.priceOverride = e.target.value === '' ? null : Number(e.target.value) })}
                      placeholder={String(PLAN_PRICES[p.id])}
                    />
                  </label>
                </div>
                <Lines label="المزايا الظاهرة (سطر لكل ميزة)" value={t.bullets || []} onChange={(v) => patch((x) => { x.bullets = v })} />
                <Lines label="مزايا «عرض المزيد» (سطر لكل ميزة)" value={t.more || []} onChange={(v) => patch((x) => { x.more = v })} rows={3} />
              </Card>
            )
          })}
        </div>
      )}

      {tab === 'faq' && (
        <Card title="الأسئلة الشائعة" icon="message">
          <Switch on={draft.faq.enabled} onChange={(v) => upd((d) => { d.faq.enabled = v })} label="إظهار القسم" wide />
          {draft.faq.items.map((f, i) => (
            <div key={i} className="card card-pad stack" style={{ gap: 6, background: 'var(--surface-2)' }}>
              <div className="row" style={{ gap: 6 }}>
                <input className="input grow" value={f.q} onChange={(e) => upd((d) => { d.faq.items[i].q = e.target.value })} placeholder="السؤال" />
                <RowTools onUp={() => upd((d) => moveIn(d.faq.items, i, -1))} onDown={() => upd((d) => moveIn(d.faq.items, i, 1))} onDel={() => upd((d) => { d.faq.items.splice(i, 1) })} />
              </div>
              <textarea className="input" rows={2} value={f.a} onChange={(e) => upd((d) => { d.faq.items[i].a = e.target.value })} placeholder="الإجابة" />
            </div>
          ))}
          <button className="btn btn-outline btn-sm" onClick={() => upd((d) => { d.faq.items.push({ q: '', a: '' }) })}><Icon name="add" size={14} /> إضافة سؤال</button>
        </Card>
      )}

      {tab === 'cta' && (
        <Card title="الدعوة الختامية" icon="zap">
          <TxtIn label="العنوان" value={draft.cta.title} onChange={(v) => upd((d) => { d.cta.title = v })} />
          <AreaIn label="النص" value={draft.cta.subtitle} onChange={(v) => upd((d) => { d.cta.subtitle = v })} rows={2} />
          <TxtIn label="نص الزر" value={draft.cta.buttonText} onChange={(v) => upd((d) => { d.cta.buttonText = v })} />
        </Card>
      )}

      {tab === 'footer' && (
        <Card title="التذييل" icon="list">
          <AreaIn label="نبذة عن المنصة" value={draft.footer.about} onChange={(v) => upd((d) => { d.footer.about = v })} />
          <div className="bold small" style={{ marginTop: 4 }}>روابط العمود الأول</div>
          {draft.footer.links.map((l, i) => (
            <div key={i} className="row" style={{ gap: 6 }}>
              <input className="input" style={{ width: 160 }} value={l.label} onChange={(e) => upd((d) => { d.footer.links[i].label = e.target.value })} placeholder="النص" />
              <input className="input grow" dir="ltr" value={l.href} onChange={(e) => upd((d) => { d.footer.links[i].href = e.target.value })} placeholder="/page أو #anchor أو https://" />
              <RowTools onUp={() => upd((d) => moveIn(d.footer.links, i, -1))} onDown={() => upd((d) => moveIn(d.footer.links, i, 1))} onDel={() => upd((d) => { d.footer.links.splice(i, 1) })} />
            </div>
          ))}
          <button className="btn btn-outline btn-sm" onClick={() => upd((d) => { d.footer.links.push({ label: '', href: '' }) })}><Icon name="add" size={14} /> إضافة رابط</button>
          <div className="bold small" style={{ marginTop: 8 }}>حسابات التواصل (اتركها فارغة للإخفاء)</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <TxtIn label="واتساب (رقم دولي)" value={draft.footer.socials.whatsapp} onChange={(v) => upd((d) => { d.footer.socials.whatsapp = v })} dir="ltr" placeholder="9665xxxxxxxx" grow />
            <TxtIn label="البريد" value={draft.footer.socials.email} onChange={(v) => upd((d) => { d.footer.socials.email = v })} dir="ltr" placeholder="hello@rbt360sa.com" grow />
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <TxtIn label="X (رابط)" value={draft.footer.socials.x} onChange={(v) => upd((d) => { d.footer.socials.x = v })} dir="ltr" grow />
            <TxtIn label="انستقرام (رابط)" value={draft.footer.socials.instagram} onChange={(v) => upd((d) => { d.footer.socials.instagram = v })} dir="ltr" grow />
            <TxtIn label="تيك توك (رابط)" value={draft.footer.socials.tiktok} onChange={(v) => upd((d) => { d.footer.socials.tiktok = v })} dir="ltr" grow />
          </div>
          <Switch on={draft.footer.showPayments !== false} onChange={(v) => upd((d) => { d.footer.showPayments = v })} label="إظهار وسائل الدفع (مدى، Visa، Mastercard، Apple Pay)" wide />
        </Card>
      )}

      {tab === 'theme' && (
        <Card title="المظهر" icon="palette">
          <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <TxtIn label="لون رئيسي بديل (فارغ = لون العلامة)" value={draft.theme.accent} onChange={(v) => upd((d) => { d.theme.accent = v })} dir="ltr" placeholder="#7c2d2d" />
            <input type="color" className="input" style={{ width: 52, height: 40, padding: 4, cursor: 'pointer' }} value={/^#[0-9a-fA-F]{6}$/.test(draft.theme.accent) ? draft.theme.accent : '#7c2d2d'} onChange={(e) => upd((d) => { d.theme.accent = e.target.value })} aria-label="اختيار اللون" />
            {draft.theme.accent && <button className="btn btn-outline btn-sm" onClick={() => upd((d) => { d.theme.accent = '' })}>مسح</button>}
          </div>
          <div className="bold small" style={{ marginTop: 8 }}>كثافة الأقسام</div>
          <div className="row" style={{ gap: 8 }}>
            {[{ id: 'comfortable', ar: 'مريحة' }, { id: 'compact', ar: 'مضغوطة' }].map((o) => (
              <button key={o.id} className={`btn btn-sm ${draft.theme.density === o.id ? 'btn-primary' : 'btn-outline'}`} onClick={() => upd((d) => { d.theme.density = o.id })}>{o.ar}</button>
            ))}
          </div>
        </Card>
      )}

      {tab === 'whatsappFloat' && (
        <Card title="زر واتساب العائم" icon="message">
          <Switch on={draft.whatsappFloat.enabled} onChange={(v) => upd((d) => { d.whatsappFloat.enabled = v })} label="إظهار الزر" wide />
          <TxtIn label="الرقم (بالصيغة الدولية)" value={draft.whatsappFloat.number} onChange={(v) => upd((d) => { d.whatsappFloat.number = v })} dir="ltr" placeholder="9665xxxxxxxx" />
          <div className="xs faint">يظهر الزر أسفل يسار الصفحة ويفتح محادثة واتساب مباشرة.</div>
        </Card>
      )}

      {/* unsaved-changes bar */}
      {dirty && (
        <div className="lx-savebar">
          <Icon name="warning" size={16} style={{ color: 'var(--warning)', flex: 'none' }} />
          <span className="small bold grow">تغييرات غير منشورة</span>
          <button className="btn btn-outline btn-sm" onClick={discard} disabled={busy}>تجاهل</button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
            <Icon name="check" size={14} /> {busy ? 'جارٍ النشر…' : 'نشر التغييرات'}
          </button>
        </div>
      )}
    </div>
  )
}

/* ---------------- small form atoms (console conventions) ---------------- */

function Card({ title, icon, children }) {
  return (
    <div className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <Icon name={icon} size={17} />
        <div className="bold">{title}</div>
      </div>
      {children}
    </div>
  )
}

function TxtIn({ label, value, onChange, placeholder, dir, grow, type = 'text' }) {
  return (
    <label className={`stack ${grow ? 'grow' : ''}`} style={{ gap: 4, minWidth: grow ? 200 : undefined }}>
      <span className="xs faint bold">{label}</span>
      <input className="input" type={type} dir={dir} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  )
}

function AreaIn({ label, value, onChange, rows = 3 }) {
  return (
    <label className="stack" style={{ gap: 4 }}>
      <span className="xs faint bold">{label}</span>
      <textarea className="input" rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

// Array-of-strings editor: one entry per line.
function Lines({ label, value = [], onChange, rows = 4 }) {
  return (
    <label className="stack" style={{ gap: 4 }}>
      <span className="xs faint bold">{label}</span>
      <textarea
        className="input" rows={rows}
        value={(value || []).join('\n')}
        onChange={(e) => onChange(e.target.value.split('\n'))}
        onBlur={(e) => onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
      />
    </label>
  )
}

function Switch({ on, onChange, label, wide }) {
  return (
    <button
      type="button" onClick={() => onChange(!on)} aria-pressed={on}
      className={wide ? 'row-between' : 'row'}
      style={{
        gap: 8, padding: wide ? 'var(--sp-2) var(--sp-3)' : '4px 6px', width: wide ? '100%' : undefined,
        borderRadius: 'var(--r-md)', border: wide ? '1px solid var(--border)' : 'none',
        background: wide ? 'var(--surface)' : 'none', cursor: 'pointer', color: 'var(--text)', fontFamily: 'inherit', fontSize: 'inherit',
        alignItems: 'center',
      }}
    >
      {label && <span className={wide ? 'grow' : ''} style={{ textAlign: 'start', fontWeight: 600 }}>{label}</span>}
      <span style={{ width: 38, height: 21, borderRadius: 999, background: on ? 'var(--brand)' : 'var(--surface-2)', border: '1px solid var(--border)', position: 'relative', transition: 'background .15s', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 2, insetInlineStart: on ? 18 : 2, width: 15, height: 15, borderRadius: '50%', background: on ? 'var(--on-brand)' : 'var(--text-faint)', transition: 'inset-inline-start .15s' }} />
      </span>
    </button>
  )
}

function RowTools({ onUp, onDown, onDel }) {
  return (
    <div className="row" style={{ gap: 4, flex: 'none' }}>
      <button className="btn btn-outline btn-xs" onClick={onUp} title="أعلى"><Icon name="arrowUp" size={13} /></button>
      <button className="btn btn-outline btn-xs" onClick={onDown} title="أسفل"><Icon name="arrowUp" size={13} style={{ transform: 'rotate(180deg)' }} /></button>
      <button className="btn btn-outline btn-xs" style={{ color: 'var(--danger)' }} onClick={onDel} title="حذف"><Icon name="delete" size={13} /></button>
    </div>
  )
}
