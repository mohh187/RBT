import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { watchTables } from '../../lib/db.js'
import { watchVenueDomains } from '../../lib/venueDomains.js'
import { printBaseCandidates } from '../../lib/qr.js'
import { qrStyleDataUrl, qrMinMm } from '../../lib/qrStyles.js'
import { stickerContent } from '../../lib/stickerContent.js'
import { resolveTenantTheme } from '../../lib/themes.js'
import Icon from '../../components/Icon.jsx'
import QrStylePicker from '../../components/QrStylePicker.jsx'
import PrintStudio from './PrintStudio.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import '../../styles/table-stickers.css'

// NAPKIN-STAND STICKERS — three faces per table.
//
// A napkin stand has a wide centre panel and two narrow sides, and guests sit
// all the way around it, so every face carries the table's QR: nobody should
// have to pick up the stand and turn it to scan. The centre sells the scan and
// explains the menu; the sides carry the games pitch and the perks so a guest
// who is already seated and bored has a second and third reason to look.
//
// Two things here are load-bearing and easy to undo by accident:
//
//  1. THE HOST IS CHOSEN, NOT INHERITED. tableUrl() builds on publicBaseUrl(),
//     which falls back to window.location.origin — printing from a preview
//     channel would bake that host into a sticker that outlives it by a year.
//     So the base is an explicit control, defaulted to the venue's own active
//     domain, and the encoded URL is shown in full for verification.
//  2. ERROR CORRECTION IS 'H'. These sit next to grease and water with a thumb
//     resting on a corner; 'H' survives ~30% damage where the app default 'M'
//     survives ~15%.

// Sheet options. A napkin-stand strip is WIDE — a 200+110+110mm set is 420mm
// across, which no A4 sheet can hold in any orientation, so the honest default
// for a real stand is `strip`: the page IS the sticker set, sized exactly, zero
// margin, one table per page. That is also what a print shop wants for die-cut
// vinyl. A4/A3 stay for venues cutting by hand off stock paper.
const SHEETS = [
  { id: 'strip', ar: 'شريحة لكل طاولة (تُقاس على التصميم)', en: 'One strip per table', margin: 0 },
  { id: 'A4', ar: 'A4 عمودي', en: 'A4 portrait', w: 210, h: 297, margin: 8 },
  { id: 'A4L', ar: 'A4 أفقي', en: 'A4 landscape', w: 297, h: 210, margin: 8 },
  { id: 'A3', ar: 'A3 عمودي', en: 'A3 portrait', w: 297, h: 420, margin: 8 },
  { id: 'A3L', ar: 'A3 أفقي', en: 'A3 landscape', w: 420, h: 297, margin: 8 },
]

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

// Millimetre field that lets you TYPE freely and only clamps when you leave it.
// The first version clamped on every keystroke via `Number(v) || 96`, so HTML's
// min/max never fired and a manager thinking in centimetres could commit 20 for
// «20 سم» and get a 20mm face — which is exactly what happened. Now the unit is
// explicit and out-of-range values snap on blur instead of silently standing.
function SizeField({ label, mm, onMm, lo, hi, unit }) {
  const toU = (v) => (unit === 'cm' ? v / 10 : v)
  const [raw, setRaw] = useState(String(toU(mm)))
  useEffect(() => { setRaw(String(toU(mm))) }, [mm, unit])
  const commit = () => {
    const n = parseFloat(String(raw).replace(',', '.'))
    if (!isFinite(n)) { setRaw(String(toU(mm))); return }
    onMm(clamp(Math.round((unit === 'cm' ? n * 10 : n) * 10) / 10, lo, hi))
  }
  return (
    <label className="ts-tool"><span>{label}</span>
      <input className="input input-sm ts-num num" inputMode="decimal" value={raw}
        onChange={(e) => setRaw(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { commit(); e.currentTarget.blur() } }} />
      <span>{unit}</span>
    </label>
  )
}

export default function TableStickers() {
  const { lang, t } = useI18n()
  const ar = lang === 'ar'
  const { tenantId, tenant } = useAuth()
  const brandDefault = resolveTenantTheme(tenant).brand

  const [tables, setTables] = useState(null)
  const [domains, setDomains] = useState([])
  const [qrs, setQrs] = useState({})
  const [picked, setPicked] = useState(null) // Set of table ids, null = all
  const [base, setBase] = useState('')
  const [cw, setCw] = useState(96)
  const [sw, setSw] = useState(48)
  const [h, setH] = useState(132)
  const [unit, setUnit] = useState('mm')
  const [sheetId, setSheetId] = useState('strip')
  const [theme, setTheme] = useState('light')
  const [brand, setBrand] = useState(brandDefault)
  const [guides, setGuides] = useState(true)
  const [zoom, setZoom] = useState(0.75)
  const [showSides, setShowSides] = useState(true)
  const [fsAdj, setFsAdj] = useState(1) // manual nudge on top of the auto scale
  const [qrStyle, setQrStyle] = useState('classic')
  const [mode, setMode] = useState('ready') // 'ready' | 'studio'

  useEffect(() => {
    if (!tenantId) return
    const u1 = watchTables(tenantId, setTables)
    const u2 = watchVenueDomains(tenantId, setDomains)
    return () => { u1(); u2() }
  }, [tenantId])

  useEffect(() => { document.body.classList.add('ts-print'); return () => document.body.classList.remove('ts-print') }, [])

  const sheet = SHEETS.find((s) => s.id === sheetId) || SHEETS[0]
  const gap = 2 // mm between faces, mirrors .ts-set gap
  const setW = cw + (showSides ? sw * 2 + gap * 2 : 0)

  // @page carries ONE size per document, so it follows the chosen sheet. In strip
  // mode the page is the sticker set itself — borderless, no cutting.
  useEffect(() => {
    let el = document.getElementById('ts-page-style')
    if (!el) { el = document.createElement('style'); el.id = 'ts-page-style'; document.head.appendChild(el) }
    el.textContent = sheet.id === 'strip'
      ? `@page { size: ${setW}mm ${h}mm; margin: 0; }`
      : `@page { size: ${sheet.w}mm ${sheet.h}mm; margin: ${sheet.margin}mm; }`
    return () => { el.remove() }
  }, [sheet, setW, h])

  const bases = useMemo(() => printBaseCandidates({ domains, slug: tenant?.slug }), [domains, tenant?.slug])
  useEffect(() => { if (!base && bases.length) setBase(bases[0].url) }, [bases, base])

  const content = useMemo(() => stickerContent(tenant, { lang }), [tenant, lang])

  const selected = useMemo(() => {
    const list = (tables || []).filter((tb) => tb.qrToken)
    return picked ? list.filter((tb) => picked.has(tb.id)) : list
  }, [tables, picked])

  // One QR per table (all three faces of a stand point at the same table).
  // The quiet zone stays at the library default: .ts-qr already sits on a white
  // pad, but the margin belongs to the code, not the CSS around it.
  useEffect(() => {
    if (!base || !tenant?.slug || !selected.length) return
    let alive = true
    const ink = theme === 'dark' ? '#14161b' : '#16181d'
    Promise.all(selected.map(async (tb) => {
      const url = `${base}/t/${tenant.slug}/${tb.qrToken}`
      const d = await qrStyleDataUrl(url, {
        styleId: qrStyle, dark: ink, dark2: brand, light: '#ffffff',
        logoUrl: tenant?.logoUrl || '', px: 640,
      })
      return [tb.id, d]
    })).then((pairs) => { if (alive) setQrs(Object.fromEntries(pairs)) }).catch(() => {})
    return () => { alive = false }
  }, [selected, base, tenant?.slug, tenant?.logoUrl, theme, qrStyle, brand])

  // How many sets land on one sheet, and whether the set even fits its width.
  const fit = useMemo(() => {
    if (sheet.id === 'strip') return { perPage: 1, cols: 1, rows: 1, usableW: setW, fits: true }
    const usableW = sheet.w - sheet.margin * 2
    const usableH = sheet.h - sheet.margin * 2
    const cols = Math.max(0, Math.floor((usableW + 4) / (setW + 4)))
    const rows = Math.max(0, Math.floor((usableH + 4) / (h + 4)))
    return { perPage: Math.max(1, cols * rows), cols, rows, usableW, fits: cols >= 1 && rows >= 1 }
  }, [sheet, setW, h])

  const pages = useMemo(() => {
    const n = sheet.id === 'strip' ? 1 : fit.perPage
    const out = []
    for (let i = 0; i < selected.length; i += n) out.push(selected.slice(i, i + n))
    return out
  }, [selected, sheet.id, fit.perPage])

  const sampleUrl = selected[0] && tenant?.slug ? `${base}/t/${tenant.slug}/${selected[0].qrToken}` : ''
  const toggle = (id) => {
    const cur = new Set(picked || (tables || []).map((x) => x.id))
    if (cur.has(id)) cur.delete(id); else cur.add(id)
    setPicked(cur)
  }

  if (tables === null) return <Spinner />

  // SCALE, AND WHY IT IS BOUNDED BY BOTH AXES.
  //
  // The design is authored to fill a 96 × 132mm centre face exactly. The scale
  // layer sizes its inner box at face/scale, so the inner box must never fall
  // below that baseline on EITHER axis or the content is pushed out of the face.
  // A first pass scaled off the width alone: a 200 × 145mm stand asked for 2.08×,
  // which left the inner box only 100mm tall against 132mm of copy and overflowed
  // by ~35mm. min() of the two ratios is the largest scale that still fits.
  const autoFs = clamp(Math.min(cw / 96, h / 132), 0.7, 3.2)
  // A stand panel much wider than it is tall cannot use a stacked layout — the
  // scale caps out on height and the surplus width becomes dead space (which is
  // exactly how a 200 × 145mm face rendered: correct type, marooned in white).
  // Past this ratio the centre face goes two-column, copy beside the code.
  const wide = cw / h > 1.15
  // The SMALLEST printed code decides whether a style is safe, and that is a side
  // face (34mm base) whenever the sides are on — not the big centre one. Feeding
  // the picker the centre size would clear a style that then fails on the sides.
  const smallestQrMm = (showSides ? 34 : wide ? 54 : 36) * autoFs * fsAdj
  const vars = {
    '--ts-cw': `${cw}mm`, '--ts-sw': `${sw}mm`, '--ts-h': `${h}mm`,
    '--ts-brand': brand, '--ts-zoom': zoom,
    '--ts-fs': Math.round(autoFs * fsAdj * 100) / 100,
  }

  // The free-form studio lives on this page as a tab rather than a separate
  // route: both tabs produce the same artefact — a sticker carrying this table's
  // QR — and sending the venue to another screen to do the other half of one job
  // was the reason nobody found the studio at all.
  if (mode === 'studio') {
    return (
      <div className="page stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="ts-toolbar no-print" style={{ marginBottom: 0 }}>
          <Link to="/admin/tables" className="icon-btn" aria-label={ar ? 'رجوع' : 'Back'}><Icon name="back" size={18} /></Link>
          <strong className="ts-toolbar-title">{ar ? 'ملصقات استاند الطاولة' : 'Table stand stickers'}</strong>
          <div className="grow" />
          <div className="segmented">
            <button className={mode === 'ready' ? 'active' : ''} onClick={() => setMode('ready')}>{ar ? 'جاهز' : 'Ready'}</button>
            <button className={mode === 'studio' ? 'active' : ''} onClick={() => setMode('studio')}>{ar ? 'تصميم حرّ' : 'Free design'}</button>
          </div>
        </div>
        <p className="xs faint" style={{ margin: 0, lineHeight: 1.7 }}>
          {ar
            ? 'صمّم بحرية: صور وخلفيات، 1539 أيقونة، 37 خطاً، تأثيرات نص، و20 شكل باركود. اختر قالب «استاند مناديل» وابدأ — واضبط أي رمز على «رمز الطاولة» ليتولّد لكل طاولة.'
            : 'Design freely — then bind any QR to the table code to generate one per table.'}
        </p>
        <PrintStudio embedded />
      </div>
    )
  }

  return (
    <div className="page ts-root" style={vars}>
      <div className="ts-toolbar no-print">
        <Link to="/admin/tables" className="icon-btn" aria-label={ar ? 'رجوع' : 'Back'}><Icon name="back" size={18} /></Link>
        <strong className="ts-toolbar-title">{ar ? 'ملصقات استاند الطاولة' : 'Table stand stickers'}</strong>
        <span className="badge badge-info">{selected.length} {ar ? 'طاولة' : 'tables'}</span>
        <div className="grow" />
        <div className="segmented">
          <button className={mode === 'ready' ? 'active' : ''} onClick={() => setMode('ready')}>{ar ? 'جاهز' : 'Ready'}</button>
          <button className={mode === 'studio' ? 'active' : ''} onClick={() => setMode('studio')}>{ar ? 'تصميم حرّ' : 'Free design'}</button>
        </div>
        <label className="ts-tool"><span>{ar ? 'تكبير' : 'Zoom'}</span>
          <input type="range" min="0.4" max="1" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ width: 90 }} />
        </label>
        <button className="btn btn-primary" onClick={() => window.print()} disabled={!selected.length}>
          <Icon name="print" size={16} /> {ar ? 'طباعة / حفظ PDF' : 'Print / Save PDF'}
        </button>
      </div>

      <div className="ts-panels no-print">
        {/* THE HOST — the one setting that can silently ruin a print run */}
        <div className="ts-panel" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <strong className="xs faint row" style={{ gap: 5 }}><Icon name="wifi" size={13} /> {ar ? 'النطاق المطبوع في الرمز' : 'Domain encoded in the QR'}</strong>
          <select className="select" value={base} onChange={(e) => setBase(e.target.value)}>
            {bases.map((b) => (
              <option key={b.url} value={b.url}>
                {b.label}{b.note === 'venue' ? ar ? ' — نطاق منشأتك' : ' — your domain' : b.note === 'current' ? ar ? ' — النطاق الحالي' : ' — current host' : ''}
              </option>
            ))}
          </select>
          {sampleUrl ? <span className="ts-url">{sampleUrl}</span> : null}
          <span className="xs" style={{ color: 'var(--warning)' }}>
            {ar ? 'الملصق يبقى على الطاولة شهوراً — تأكّد أن هذا النطاق سيعمل طويلاً قبل الطباعة.' : 'Stickers outlive tabs — confirm this host is permanent.'}
          </span>
        </div>

        {/* physical size */}
        <div className="ts-panel">
          <div className="segmented" style={{ flexShrink: 0 }}>
            <button className={unit === 'mm' ? 'active' : ''} onClick={() => setUnit('mm')}>mm</button>
            <button className={unit === 'cm' ? 'active' : ''} onClick={() => setUnit('cm')}>cm</button>
          </div>
          <SizeField label={ar ? 'الوجه الأوسط' : 'Centre'} mm={cw} onMm={setCw} lo={30} hi={400} unit={unit} />
          <SizeField label={ar ? 'الجانبان' : 'Sides'} mm={sw} onMm={setSw} lo={20} hi={300} unit={unit} />
          <SizeField label={ar ? 'الارتفاع' : 'Height'} mm={h} onMm={setH} lo={40} hi={400} unit={unit} />
          <span className="xs faint">
            {ar ? `الشريحة ${setW} × ${h} مم` : `Strip ${setW} × ${h} mm`}
            {sheet.id !== 'strip' ? ` · ${fit.perPage} ${ar ? 'طاولة/صفحة' : 'per page'}` : ''}
          </span>
          <button className="btn btn-sm btn-outline" onClick={() => { setCw(200); setSw(110); setH(145) }}>
            {ar ? 'مقاس استاند 42 سم' : '42cm stand'}
          </button>
          <label className="ts-tool"><span>{ar ? 'حجم التصميم' : 'Design scale'}</span>
            <input type="range" min="0.7" max="1.5" step="0.05" value={fsAdj} onChange={(e) => setFsAdj(Number(e.target.value))} style={{ width: 80 }} />
            <span className="xs faint">{Math.round(autoFs * fsAdj * 100)}%</span>
          </label>
        </div>

        {/* sheet */}
        <div className="ts-panel" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <strong className="xs faint row" style={{ gap: 5 }}><Icon name="file" size={13} /> {ar ? 'الورقة' : 'Sheet'}</strong>
          <select className="select" value={sheetId} onChange={(e) => setSheetId(e.target.value)}>
            {SHEETS.map((s) => <option key={s.id} value={s.id}>{ar ? s.ar : s.en}</option>)}
          </select>
          {sheet.id === 'strip' ? (
            <span className="xs faint">{ar ? `الصفحة = الشريحة نفسها (${setW}×${h} مم) بلا هوامش — اختر «بلا حدود» في الطابعة.` : `Page equals the strip — print borderless.`}</span>
          ) : !fit.fits ? (
            <span className="xs" style={{ color: 'var(--danger)' }}>
              {ar ? `الشريحة ${setW} مم أعرض من المساحة المتاحة (${fit.usableW} مم). اختر ورقة أكبر أو «شريحة لكل طاولة».` : `Strip is wider than the sheet.`}
            </span>
          ) : (
            <span className="xs faint">{ar ? `${fit.cols} × ${fit.rows} شريحة في الصفحة` : `${fit.cols} × ${fit.rows} per page`}</span>
          )}
        </div>

        {/* look */}
        <div className="ts-panel">
          <label className="ts-chip"><input type="checkbox" checked={showSides} onChange={(e) => setShowSides(e.target.checked)} /><span>{ar ? 'الوجهان الجانبيان' : 'Side faces'}</span></label>
          <label className="ts-chip"><input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /><span>{ar ? 'خطوط القص' : 'Cut guides'}</span></label>
          <div className="segmented">
            <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>{ar ? 'فاتح' : 'Light'}</button>
            <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>{ar ? 'داكن' : 'Dark'}</button>
          </div>
          <label className="ts-tool"><span>{ar ? 'اللون' : 'Accent'}</span>
            <input type="color" value={brand} onChange={(e) => setBrand(e.target.value)} style={{ width: 34, height: 30, padding: 2, border: '1px solid var(--border)', borderRadius: 8, background: 'none', cursor: 'pointer' }} />
          </label>
        </div>

        {/* QR shape — 20 styles, each verified by decoding before it is trusted */}
        <div className="ts-panel" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, flexBasis: '100%' }}>
          <QrStylePicker
            value={qrStyle} onChange={setQrStyle}
            text={sampleUrl}
            dark={theme === 'dark' ? '#14161b' : '#16181d'} dark2={brand} light="#ffffff"
            logoUrl={tenant?.logoUrl || ''}
            printedMm={smallestQrMm}
            compact
          />
        </div>

        {/* which tables */}
        {tables.length > 1 && (
          <div className="ts-panel" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div className="row" style={{ gap: 6 }}>
              <strong className="xs faint">{ar ? 'الطاولات المطبوعة' : 'Tables'}</strong>
              <button className="btn btn-sm btn-outline" onClick={() => setPicked(null)}>{ar ? 'الكل' : 'All'}</button>
            </div>
            <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
              {tables.map((tb) => {
                const on = picked ? picked.has(tb.id) : true
                return <button key={tb.id} className={`chip ${on ? 'active' : ''}`} onClick={() => toggle(tb.id)}>{tb.label}</button>
              })}
            </div>
          </div>
        )}
      </div>

      {!tables.length ? (
        <Empty icon="tables" title={ar ? 'لا توجد طاولات' : 'No tables'} hint={ar ? 'أضِف طاولات أولاً من شاشة الطاولات، ثم اطبع ملصقاتها.' : 'Add tables first.'} />
      ) : !selected.length ? (
        <Empty icon="qr" title={ar ? 'لم تُختر طاولة' : 'No table selected'} hint={ar ? 'اختر طاولة واحدة على الأقل.' : 'Pick at least one table.'} />
      ) : (
        <div className="ts-backdrop">
          <div className="ts-pages">
            {pages.map((group, pi) => (
              <div className="ts-sheet" key={pi} dir={ar ? 'rtl' : 'ltr'}
                data-theme={theme} data-guides={guides ? 'true' : 'false'} data-strip={sheet.id === 'strip' ? 'true' : undefined}
                style={sheet.id === 'strip'
                  ? { width: `${setW}mm`, padding: 0 }
                  : { width: `${sheet.w}mm`, padding: `${sheet.margin}mm` }}>
                {group.map((tb) => (
                  <div className="ts-set" key={tb.id}>
                    <CenterFace table={tb} tenant={tenant} content={content} qr={qrs[tb.id]} ar={ar} wide={wide} />
                    {showSides && (
                      <>
                        {content.gamesFace
                          ? <GamesFace table={tb} content={content} qr={qrs[tb.id]} ar={ar} />
                          : <PerksFace table={tb} content={content} qr={qrs[tb.id]} ar={ar} />}
                        <PerksFace table={tb} content={content} qr={qrs[tb.id]} ar={ar} venue={tenant?.name} />
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TableBadge({ label, ar }) {
  return (
    <div className="ts-table">
      <span>{ar ? 'طاولة' : 'TABLE'}</span>
      <strong dir="ltr">{String(label || '').replace(/[^\dA-Za-z-]/g, '') || label}</strong>
    </div>
  )
}

// The side faces get the smaller box from `.ts-face--side .ts-qr`, so this stays
// size-agnostic — one component, two physical sizes, no prop threading.
function Qr({ src }) {
  if (!src) return <div className="ts-qr-ph" />
  return <img className="ts-qr" src={src} alt="" />
}

// Stacked on a tall panel, two-column on a wide one. Same blocks either way —
// only the flex direction and where the QR sits change, driven off data-wide.
function CenterFace({ table, tenant, content, qr, ar, wide }) {
  return (
    <div className="ts-face ts-face--center" data-wide={wide ? 'true' : undefined}>
      <div className="ts-scale">
      <div className="ts-col">
      <div className="ts-top">
        <div className="ts-head">
          <div className="row" style={{ gap: '2.4mm', alignItems: 'center' }}>
            {tenant?.logoUrl ? <img className="ts-logo" src={tenant.logoUrl} alt="" /> : null}
            <div className="ts-venue">
              {tenant?.name || ''}
              {tenant?.descAr ? <small>{tenant.descAr}</small> : null}
            </div>
          </div>
          <TableBadge label={table.label} ar={ar} />
        </div>
        <h1 className="ts-hook" style={{ marginTop: '3.4mm' }}>{content.hook}</h1>
        <p className="ts-sub">{content.sub}</p>
      </div>

      <div>
        <div className="ts-rule" style={{ marginBottom: '2.6mm' }} />
        <div className="ts-feats">
          {content.features.map((f, i) => (
            <div className="ts-feat" key={i}>
              <Icon name={f.icon} size={13} strokeWidth={2.3} className="ts-ico" />
              <div>
                <b>{f.title}</b>
                <i>{f.body}</i>
              </div>
            </div>
          ))}
        </div>
      </div>
      </div>

      <div className="ts-qrwrap">
        <Qr src={qr} />
        <div className="ts-qrnote">
          <strong>{ar ? 'وجّه الكاميرا للرمز' : 'Point your camera here'}</strong>
          {ar ? 'بلا تطبيق وبلا تسجيل دخول — القائمة تفتح في ثانية.' : 'No app, no login — opens in a second.'}
        </div>
      </div>
      </div>
    </div>
  )
}

function GamesFace({ table, content, qr, ar }) {
  const g = content.gamesFace
  return (
    <div className="ts-face ts-face--side">
      <div className="ts-scale">
      <div className="ts-top">
        <div className="ts-head">
          <div>
            <div className="ts-kicker">{g.kicker}</div>
            <div className="ts-stitle">{g.title}</div>
          </div>
          <TableBadge label={table.label} ar={ar} />
        </div>
        {g.names.length > 0 && (
          <div className="ts-names" style={{ marginTop: '2.2mm' }}>{g.names.map((n) => <span key={n}>{n}</span>)}</div>
        )}
        {g.more ? <p className="ts-more">{g.more}</p> : null}
      </div>

      <div className="ts-rows">
        {g.rows.map((r, i) => (
          <div className="ts-row" key={i}>
            <Icon name={r.icon} size={11} strokeWidth={2.3} className="ts-ico" />
            <span>{r.text}</span>
          </div>
        ))}
      </div>

      <div className="ts-foot">
        <div className="ts-cta"><Icon name="scan" size={13} strokeWidth={2.4} /> {g.cta}</div>
        <Qr src={qr} />
      </div>
      </div>
    </div>
  )
}

function PerksFace({ table, content, qr, ar, venue }) {
  const p = content.perksFace
  return (
    <div className="ts-face ts-face--side">
      <div className="ts-scale">
      <div className="ts-top">
        <div className="ts-head">
          <div>
            <div className="ts-kicker">{p.kicker}</div>
            <div className="ts-stitle">{p.title}</div>
          </div>
          <TableBadge label={table.label} ar={ar} />
        </div>
      </div>

      <div className="ts-rows">
        {p.rows.map((r, i) => (
          <div className="ts-row" key={i}>
            <Icon name={r.icon} size={11} strokeWidth={2.3} className="ts-ico" />
            <span>{r.text}</span>
          </div>
        ))}
      </div>

      <div className="ts-foot">
        <div className="ts-cta"><Icon name="scan" size={13} strokeWidth={2.4} /> {p.cta}</div>
        <Qr src={qr} />
        {venue ? <div className="ts-brandline" style={{ marginTop: '1.4mm' }}>{venue}</div> : null}
      </div>
      </div>
    </div>
  )
}
