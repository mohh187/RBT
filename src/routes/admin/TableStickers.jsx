import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { watchTables } from '../../lib/db.js'
import { watchVenueDomains } from '../../lib/venueDomains.js'
import { qrDataUrl, printBaseCandidates } from '../../lib/qr.js'
import { stickerContent } from '../../lib/stickerContent.js'
import { resolveTenantTheme } from '../../lib/themes.js'
import Icon from '../../components/Icon.jsx'
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

const A4_H = 297
const PAGE_MARGIN = 8

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
  const [theme, setTheme] = useState('light')
  const [brand, setBrand] = useState(brandDefault)
  const [guides, setGuides] = useState(true)
  const [zoom, setZoom] = useState(0.75)
  const [showSides, setShowSides] = useState(true)

  useEffect(() => {
    if (!tenantId) return
    const u1 = watchTables(tenantId, setTables)
    const u2 = watchVenueDomains(tenantId, setDomains)
    return () => { u1(); u2() }
  }, [tenantId])

  useEffect(() => { document.body.classList.add('ts-print'); return () => document.body.classList.remove('ts-print') }, [])

  useEffect(() => {
    let el = document.getElementById('ts-page-style')
    if (!el) { el = document.createElement('style'); el.id = 'ts-page-style'; document.head.appendChild(el) }
    el.textContent = `@page { size: A4; margin: ${PAGE_MARGIN}mm; }`
    return () => { el.remove() }
  }, [])

  const bases = useMemo(() => printBaseCandidates({ domains, slug: tenant?.slug }), [domains, tenant?.slug])
  useEffect(() => { if (!base && bases.length) setBase(bases[0].url) }, [bases, base])

  const content = useMemo(() => stickerContent(tenant, { lang }), [tenant, lang])

  const selected = useMemo(() => {
    const list = (tables || []).filter((tb) => tb.qrToken)
    return picked ? list.filter((tb) => picked.has(tb.id)) : list
  }, [tables, picked])

  // One QR per table (all three faces of a stand point at the same table).
  useEffect(() => {
    if (!base || !tenant?.slug || !selected.length) return
    let alive = true
    const dark = theme === 'dark' ? '#14161b' : '#16181d'
    Promise.all(selected.map(async (tb) => {
      const url = `${base}/t/${tenant.slug}/${tb.qrToken}`
      const d = await qrDataUrl(url, { width: 640, margin: 1, ec: 'H', dark, light: '#ffffff' })
      return [tb.id, d]
    })).then((pairs) => { if (alive) setQrs(Object.fromEntries(pairs)) }).catch(() => {})
    return () => { alive = false }
  }, [selected, base, tenant?.slug, theme])

  const perPage = Math.max(1, Math.floor((A4_H - PAGE_MARGIN * 2) / (h + 4)))
  const sampleUrl = selected[0] && tenant?.slug ? `${base}/t/${tenant.slug}/${selected[0].qrToken}` : ''
  const toggle = (id) => {
    const cur = new Set(picked || (tables || []).map((x) => x.id))
    if (cur.has(id)) cur.delete(id); else cur.add(id)
    setPicked(cur)
  }

  if (tables === null) return <Spinner />

  const vars = {
    '--ts-cw': `${cw}mm`, '--ts-sw': `${sw}mm`, '--ts-h': `${h}mm`,
    '--ts-brand': brand, '--ts-zoom': zoom,
  }
  const totalW = cw + (showSides ? sw * 2 : 0) + (showSides ? 4 : 0)

  return (
    <div className="page ts-root" style={vars}>
      <div className="ts-toolbar no-print">
        <Link to="/admin/tables" className="icon-btn" aria-label={ar ? 'رجوع' : 'Back'}><Icon name="back" size={18} /></Link>
        <strong className="ts-toolbar-title">{ar ? 'ملصقات استاند الطاولة' : 'Table stand stickers'}</strong>
        <span className="badge badge-info">{selected.length} {ar ? 'طاولة' : 'tables'}</span>
        <div className="grow" />
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
          <label className="ts-tool"><span>{ar ? 'الوجه الأوسط' : 'Centre'}</span>
            <input className="input input-sm ts-num num" type="number" min="60" max="200" value={cw} onChange={(e) => setCw(Number(e.target.value) || 96)} /> <span>mm</span>
          </label>
          <label className="ts-tool"><span>{ar ? 'الجانبان' : 'Sides'}</span>
            <input className="input input-sm ts-num num" type="number" min="28" max="120" value={sw} onChange={(e) => setSw(Number(e.target.value) || 48)} /> <span>mm</span>
          </label>
          <label className="ts-tool"><span>{ar ? 'الارتفاع' : 'Height'}</span>
            <input className="input input-sm ts-num num" type="number" min="70" max="270" value={h} onChange={(e) => setH(Number(e.target.value) || 132)} /> <span>mm</span>
          </label>
          <span className="xs faint">{ar ? `العرض الكلي ${totalW}mm · ${perPage} طاولة/صفحة` : `${totalW}mm wide · ${perPage}/page`}</span>
          {totalW > 210 - PAGE_MARGIN * 2 && (
            <span className="xs" style={{ color: 'var(--danger)' }}>{ar ? 'أعرض من A4 — قلّل المقاسات' : 'Wider than A4'}</span>
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
            <div className="ts-sheet" dir={ar ? 'rtl' : 'ltr'} data-theme={theme} data-guides={guides ? 'true' : 'false'}>
              {selected.map((tb) => (
                <div className="ts-set" key={tb.id}>
                  <CenterFace table={tb} tenant={tenant} content={content} qr={qrs[tb.id]} ar={ar} />
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

function CenterFace({ table, tenant, content, qr, ar }) {
  return (
    <div className="ts-face ts-face--center">
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

      <h1 className="ts-hook">{content.hook}</h1>
      <p className="ts-sub">{content.sub}</p>

      <div className="ts-qrwrap">
        <Qr src={qr} />
        <div className="ts-qrnote">
          <strong>{ar ? 'وجّه الكاميرا للرمز' : 'Point your camera here'}</strong>
          {ar ? 'بلا تطبيق وبلا تسجيل دخول — القائمة تفتح في ثانية.' : 'No app, no login — opens in a second.'}
        </div>
      </div>

      <div className="ts-rule" />
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
  )
}

function GamesFace({ table, content, qr, ar }) {
  const g = content.gamesFace
  return (
    <div className="ts-face ts-face--side">
      <div className="ts-head">
        <div>
          <div className="ts-kicker">{g.kicker}</div>
          <div className="ts-stitle">{g.title}</div>
        </div>
        <TableBadge label={table.label} ar={ar} />
      </div>

      {g.names.length > 0 && (
        <div className="ts-names">{g.names.map((n) => <span key={n}>{n}</span>)}</div>
      )}
      {g.more ? <p className="ts-more">{g.more}</p> : null}

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
  )
}

function PerksFace({ table, content, qr, ar, venue }) {
  const p = content.perksFace
  return (
    <div className="ts-face ts-face--side">
      <div className="ts-head">
        <div>
          <div className="ts-kicker">{p.kicker}</div>
          <div className="ts-stitle">{p.title}</div>
        </div>
        <TableBadge label={table.label} ar={ar} />
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
  )
}
