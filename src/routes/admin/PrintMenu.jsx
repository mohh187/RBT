import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchItems, watchCategories, updateTenant } from '../../lib/db.js'
import { resolveTenantTheme } from '../../lib/themes.js'
import { FONT_OPTIONS, fontStacks, loadFont } from '../../lib/skins.js'
import { qrDataUrl, menuUrl } from '../../lib/qr.js'
import { Price } from '../../components/Riyal.jsx'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'

// Print-menu DESIGNER — a structured design studio for the printed menu:
// themes (derived from the menu-skin families), product-image display modes,
// fonts, colors, header/footer/QR, per-category selection, all persisted to
// tenant.printDesign. Export stays the browser print dialog (PDF) via the
// pm-* engine (@page injection + body.pm-print) appended in index.css.

const PAGE_SIZES = ['A4', 'A5', 'A3']

// Print themes: page bg / ink / accent / divider style. Independent of the
// screen skins but mapped FROM them by the smart preset below.
const PRINT_THEMES = [
  { id: 'classic', ar: 'كلاسيكي أنيق', bg: '#ffffff', ink: '#1c1c1e', sub: '#6b6b70', accent: null },
  { id: 'noir', ar: 'فاخر داكن', bg: '#141416', ink: '#f3ede2', sub: '#b9b2a4', accent: '#c9a24b' },
  { id: 'warm', ar: 'مقهى دافئ', bg: '#faf5ee', ink: '#3d2f23', sub: '#8a7a68', accent: '#b4632c' },
  { id: 'sharp', ar: 'حاد عملي', bg: '#ffffff', ink: '#111111', sub: '#555555', accent: '#111111' },
  { id: 'paper', ar: 'ورقي تراثي', bg: '#f8f4ea', ink: '#42392c', sub: '#7d735f', accent: '#42392c' },
  { id: 'gold', ar: 'ذهبي ملكي', bg: '#fffdf7', ink: '#2b2418', sub: '#8c7f63', accent: '#a8842c' },
]

// digital skin family → closest print theme (the «مطابقة ثيمي الرقمي» preset)
const SKIN_TO_PRINT = { noir: 'noir', luxe: 'gold', glass: 'classic', nova: 'sharp', classic: 'classic', paper: 'paper', wood: 'warm' }

const IMG_MODES = [
  ['none', 'بدون صور'], ['circle', 'دائرية صغيرة'], ['rounded', 'مربعة مدوّرة'],
  ['large', 'بارزة كبيرة'], ['banner', 'خلفية شفافة'],
]

function priceOf(it) {
  const base = Number(it.price) || 0
  if (base > 0) return base
  const vs = (it.variants || []).map((v) => Number(v.price) || 0).filter((v) => v > 0)
  return vs.length ? Math.min(...vs) : 0
}

const DEFAULT_DESIGN = {
  theme: 'classic', imgMode: 'circle', font: 'tajawal', pageSize: 'A4', landscape: false,
  cols: 2, fs: 1, accent: '', subtitle: '', footerText: '', showQr: true,
  showDesc: true, showEn: true, showCal: false, excluded: [],
}

export default function PrintMenu() {
  const { lang, t } = useI18n()
  const ar = lang === 'ar'
  const { tenantId, tenant, updateTenantLocal } = useAuth()
  const toast = useToast()
  const currency = tenant?.currency || 'SAR'
  const brand = resolveTenantTheme(tenant).brand

  const [cats, setCats] = useState(null)
  const [items, setItems] = useState(null)
  const [d, setD] = useState(() => ({ ...DEFAULT_DESIGN, ...(tenant?.printDesign || {}) }))
  const [zoom, setZoom] = useState(0.8)
  const [qr, setQr] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }))

  const theme = PRINT_THEMES.find((x) => x.id === d.theme) || PRINT_THEMES[0]
  const accent = d.accent || theme.accent || brand
  const fonts = fontStacks(d.font)

  useEffect(() => { loadFont(d.font) }, [d.font])
  useEffect(() => {
    if (!tenant?.slug || !d.showQr) { setQr(''); return }
    qrDataUrl(menuUrl(tenant.slug), { width: 160 }).then(setQr).catch(() => {})
  }, [tenant?.slug, d.showQr])

  useEffect(() => {
    if (!tenantId) return
    const u1 = watchCategories(tenantId, setCats)
    const u2 = watchItems(tenantId, setItems)
    return () => { u1(); u2() }
  }, [tenantId])

  useEffect(() => {
    document.body.classList.add('pm-print')
    return () => document.body.classList.remove('pm-print')
  }, [])

  useEffect(() => {
    let el = document.getElementById('pm-page-style')
    if (!el) { el = document.createElement('style'); el.id = 'pm-page-style'; document.head.appendChild(el) }
    el.textContent = `@page { size: ${d.pageSize}${d.landscape ? ' landscape' : ''}; margin: 12mm; }`
    return () => { el.remove() }
  }, [d.pageSize, d.landscape])

  const groups = useMemo(() => {
    if (!cats || !items) return null
    const excluded = new Set(d.excluded || [])
    const visible = items.filter((it) => it.available !== false && !it.archived)
    const byCat = new Map()
    for (const it of visible) {
      const key = it.categoryId || ''
      if (!byCat.has(key)) byCat.set(key, [])
      byCat.get(key).push(it)
    }
    const out = cats
      .filter((c) => !excluded.has(c.id) && (byCat.get(c.id) || []).length)
      .map((c) => ({ cat: c, list: byCat.get(c.id) }))
    const known = new Set(cats.map((c) => c.id))
    const orphans = [...byCat.entries()].filter(([k]) => !known.has(k)).flatMap(([, v]) => v)
    if (orphans.length && !excluded.has('_other')) out.push({ cat: { id: '_other', nameAr: 'أخرى', nameEn: 'Other' }, list: orphans })
    return out
  }, [cats, items, d.excluded])

  const toggleCat = (id) => set('excluded', (d.excluded || []).includes(id) ? d.excluded.filter((x) => x !== id) : [...(d.excluded || []), id])

  // One tap: mirror the venue's CURRENT digital identity onto the print design.
  const smartPreset = () => {
    const skinId = tenant?.skin?.id || tenant?.skinId || 'classic'
    setD((x) => ({
      ...x,
      theme: SKIN_TO_PRINT[skinId] || 'classic',
      accent: brand,
      font: tenant?.skin?.overrides?.font || x.font,
      subtitle: tenant?.descAr || x.subtitle,
    }))
    toast.success(ar ? 'طُبّقت هوية منيوك الرقمي — عدّل ما تشاء ثم احفظ' : 'Digital identity applied')
  }

  const save = async () => {
    setSaving(true)
    try {
      await updateTenant(tenantId, { printDesign: d })
      updateTenantLocal?.({ printDesign: d })
      toast.success(t('saved'))
    } catch (_) { toast.error(t('error')) } finally { setSaving(false) }
  }

  const loading = !groups
  const sheetVars = {
    '--pm-brand': accent,
    '--pm-bg': theme.bg,
    '--pm-ink': theme.ink,
    '--pm-sub': theme.sub,
    '--pm-fs': d.fs,
    '--pm-font-body': fonts.body,
    '--pm-font-display': fonts.display,
  }

  return (
    <div className="page pm-root" style={{ '--pm-zoom': zoom }}>
      {/* -------- designer toolbar (never printed) -------- */}
      <div className="pm-toolbar no-print" style={{ flexWrap: 'wrap' }}>
        <Link to="/admin/menu" className="icon-btn" aria-label={ar ? 'رجوع' : 'Back'}><Icon name="back" size={18} /></Link>
        <strong className="pm-toolbar-title">{ar ? 'مصمم المنيو المطبوع' : 'Print menu designer'}</strong>
        <button className="btn btn-sm btn-outline" onClick={smartPreset}><Icon name="sparkles" size={14} /> {ar ? 'مطابقة ثيمي الرقمي' : 'Match my digital theme'}</button>
        <div className="grow" />
        <label className="pm-tool"><span>{ar ? 'تكبير' : 'Zoom'}</span>
          <input type="range" min="0.5" max="1" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ width: 90 }} />
        </label>
        <button className="btn btn-sm btn-outline" disabled={saving} onClick={save}><Icon name="check" size={14} /> {saving ? t('saving') : (ar ? 'حفظ التصميم' : 'Save design')}</button>
        <button className="btn pm-print-btn" onClick={() => window.print()}>
          <Icon name="print" size={16} /><span>{ar ? 'طباعة / حفظ PDF' : 'Print / Save PDF'}</span>
        </button>
      </div>

      <div className="pm-studio no-print">
        {/* الثيم */}
        <div className="pm-panel">
          <strong className="xs faint">{ar ? 'الثيم' : 'Theme'}</strong>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {PRINT_THEMES.map((th) => (
              <button key={th.id} className={`chip ${d.theme === th.id ? 'active' : ''}`} onClick={() => set('theme', th.id)}>
                <span style={{ width: 12, height: 12, borderRadius: 4, background: th.bg, border: `2px solid ${th.accent || brand}`, display: 'inline-block', marginInlineEnd: 4 }} />
                {th.ar}
              </button>
            ))}
          </div>
        </div>
        {/* الصور + الخط */}
        <div className="pm-panel">
          <label className="pm-tool"><span>{ar ? 'عرض الصور' : 'Images'}</span>
            <select className="select" value={d.imgMode} onChange={(e) => set('imgMode', e.target.value)}>
              {IMG_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="pm-tool"><span>{ar ? 'الخط' : 'Font'}</span>
            <select className="select" value={d.font} onChange={(e) => set('font', e.target.value)}>
              {FONT_OPTIONS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          <label className="pm-tool"><span>{ar ? 'حجم الخط' : 'Text size'}</span>
            <input type="range" min="0.85" max="1.3" step="0.05" value={d.fs} onChange={(e) => set('fs', Number(e.target.value))} style={{ width: 90 }} />
          </label>
          <label className="pm-tool"><span>{ar ? 'اللون المميز' : 'Accent'}</span>
            <input type="color" value={d.accent || brand} onChange={(e) => set('accent', e.target.value)} style={{ width: 34, height: 30, padding: 2, border: '1px solid var(--border)', borderRadius: 8, background: 'none', cursor: 'pointer' }} />
          </label>
        </div>
        {/* الصفحة */}
        <div className="pm-panel">
          <label className="pm-tool"><span>{ar ? 'المقاس' : 'Size'}</span>
            <select className="select" value={d.pageSize} onChange={(e) => set('pageSize', e.target.value)}>
              {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="pm-chip"><input type="checkbox" checked={d.landscape} onChange={(e) => set('landscape', e.target.checked)} /><span>{ar ? 'عرضي' : 'Landscape'}</span></label>
          <label className="pm-tool"><span>{ar ? 'الأعمدة' : 'Columns'}</span>
            <select className="select" value={d.cols} onChange={(e) => set('cols', Number(e.target.value))}>
              <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
            </select>
          </label>
          <label className="pm-chip"><input type="checkbox" checked={d.showDesc} onChange={(e) => set('showDesc', e.target.checked)} /><span>{ar ? 'الوصف' : 'Descriptions'}</span></label>
          <label className="pm-chip"><input type="checkbox" checked={d.showEn} onChange={(e) => set('showEn', e.target.checked)} /><span>{ar ? 'الإنجليزية' : 'English'}</span></label>
          <label className="pm-chip"><input type="checkbox" checked={d.showCal} onChange={(e) => set('showCal', e.target.checked)} /><span>{ar ? 'السعرات' : 'Calories'}</span></label>
          <label className="pm-chip"><input type="checkbox" checked={d.showQr} onChange={(e) => set('showQr', e.target.checked)} /><span>QR</span></label>
        </div>
        {/* نصوص الرأس والتذييل */}
        <div className="pm-panel">
          <input className="input input-sm" style={{ maxWidth: 220 }} placeholder={ar ? 'سطر تحت الاسم (اختياري)' : 'Subtitle'} value={d.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
          <input className="input input-sm" style={{ maxWidth: 220 }} placeholder={ar ? 'نص التذييل (اختياري)' : 'Footer text'} value={d.footerText} onChange={(e) => set('footerText', e.target.value)} />
        </div>
        {/* التصنيفات المشمولة */}
        {cats && cats.length > 0 && (
          <div className="pm-panel">
            <strong className="xs faint">{ar ? 'التصنيفات المطبوعة' : 'Included categories'}</strong>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {cats.map((c) => (
                <button key={c.id} className={`chip ${(d.excluded || []).includes(c.id) ? '' : 'active'}`} onClick={() => toggleCat(c.id)}>
                  {ar ? (c.nameAr || c.nameEn) : (c.nameEn || c.nameAr)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* -------- document preview -------- */}
      <div className="pm-backdrop">
        <div className="pm-sheet" dir="rtl" data-size={d.pageSize} data-cols={d.cols} data-ptheme={theme.id} data-imgstyle={d.imgMode} data-landscape={d.landscape ? 'true' : undefined} style={sheetVars}>
          <header className="pm-head">
            {tenant?.logoUrl ? <img className="pm-logo" src={tenant.logoUrl} alt="" /> : null}
            <h1 className="pm-venue">{tenant?.name || ''}</h1>
            {(d.subtitle || tenant?.descAr) ? <p className="pm-tagline">{d.subtitle || tenant.descAr}</p> : null}
            <div className="pm-rule" aria-hidden="true" />
          </header>

          {loading ? (
            <div className="center no-print" style={{ padding: 40 }}><Spinner /></div>
          ) : groups.length === 0 ? (
            <div className="no-print"><Empty title={ar ? 'لا توجد أصناف لعرضها' : 'No items to print'} /></div>
          ) : (
            <div className="pm-body">
              {groups.map(({ cat, list }) => (
                <section className="pm-cat" key={cat.id}>
                  <h2 className="pm-cat-title">
                    <span>{ar ? (cat.nameAr || cat.nameEn) : (cat.nameEn || cat.nameAr)}</span>
                    {d.showEn && cat.nameEn && cat.nameAr ? <small>{cat.nameEn}</small> : null}
                  </h2>
                  {list.map((it) => (
                    <div className="pm-item" key={it.id}>
                      {d.imgMode !== 'none' && it.imageUrl ? <img className="pm-item-img" src={it.imageUrl} alt="" /> : null}
                      <div className="pm-item-main">
                        <div className="pm-item-row">
                          <span className="pm-item-name">{it.nameAr || it.nameEn}</span>
                          <span className="pm-item-dots" aria-hidden="true" />
                          <span className="pm-item-price"><Price value={priceOf(it)} currency={currency} lang="ar" symbolSize="0.85em" /></span>
                        </div>
                        {d.showEn && it.nameEn && it.nameAr ? <div className="pm-item-en" dir="ltr">{it.nameEn}</div> : null}
                        {d.showDesc && (it.descAr || it.descEn) ? <p className="pm-item-desc">{it.descAr || it.descEn}</p> : null}
                        {d.showCal && Number(it.calories) > 0 ? <span className="pm-item-cal">{Number(it.calories)} {ar ? 'سعرة' : 'kcal'}</span> : null}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}

          <footer className="pm-foot">
            <div className="stack" style={{ gap: 4, alignItems: 'center' }}>
              {d.footerText ? <span>{d.footerText}</span> : <span>{tenant?.name || ''}</span>}
              {qr ? <img src={qr} alt="" style={{ width: 64, height: 64 }} /> : null}
              {qr ? <span style={{ fontSize: 9, color: 'var(--pm-sub)' }}>{ar ? 'امسح لتطلب من جوالك' : 'Scan to order'}</span> : null}
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}
