// «مظهر شاشة العرض» — the venue's live-preview editor for how the wall/TV match
// screen LOOKS while a game or tournament is on. Mounted as a tab inside
// routes/admin/GamesHub.jsx.
//
// WRITES exactly one tenant field: `tenant.screenFx` (see SHAPE below). The
// screen-render side (components/screen/*, routes/screen/*) READS the same field
// and paints it — this file never reads it back onto the screen itself, so the
// two sides only ever meet through this one documented shape.
//
//   tenant.screenFx = {
//     version: 1,
//     accent: '#e7c46a',            // frame + accent colour; '' → venue default
//     celebrations: {
//       enabled:   true,            // master on/off for win / round celebrations
//       confetti:  true,            // confetti burst
//       messages:  true,            // encouragement / celebration line
//       intensity: 'normal',        // 'calm' | 'normal' | 'party'
//     },
//     background: {
//       type: 'none',               // 'none' | 'image' | 'video'
//       url: '',                    // media URL (image or video)
//       opacity: 0.45,              // 0..1  — background layer opacity
//       posX: 50,                   // 0..100 (%) — object-position X
//       posY: 50,                   // 0..100 (%) — object-position Y
//       scale: 1,                   // 1..2.5 — zoom multiplier
//       blur: 0,                    // px 0..24
//       brightness: 1,              // 0.4..1.6
//       contrast: 1,                // 0.6..1.6
//       saturate: 1,                // 0..2
//       tint: 0,                    // -100..100 (neg = cool blue, pos = warm amber)
//     },
//   }
//
// The FILTER / TINT mapping the render side must mirror (identical to buildBg()
// below):
//   media filter  = `blur({blur}px) brightness({brightness}) contrast({contrast}) saturate({saturate})`
//   media pos     = object-fit:cover; object-position:{posX}% {posY}%; transform:scale({scale})
//   tint overlay  = a sibling div over the media, mix-blend-mode:overlay,
//                   colour #ff8a3d (tint>0) or #3d7bff (tint<0),
//                   opacity = min(0.5, abs(tint)/100 * 0.5)
//   whole layer   = wrapped in opacity:{opacity}
// Filters touch the BACKGROUND LAYER ONLY — never the score cards, board or text.

import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { useToast } from '../Toast.jsx'
import { uploadImage, uploadFile } from '../../lib/storage.js'
import MediaLibrary from '../MediaLibrary.jsx'
import '../../styles/screen-appearance.css'

// ---------------------------------------------------------------------------
// the canonical default — export it so the render side can seed from the same
// object rather than re-typing the keys (drift is the enemy here).
// ---------------------------------------------------------------------------
export const DEFAULT_SCREEN_FX = {
  version: 1,
  accent: '',
  celebrations: { enabled: true, confetti: true, messages: true, intensity: 'normal' },
  background: {
    type: 'none', url: '',
    opacity: 0.45, posX: 50, posY: 50, scale: 1,
    blur: 0, brightness: 1, contrast: 1, saturate: 1, tint: 0,
  },
}

const clamp = (n, lo, hi, dflt) => {
  const v = Number(n)
  if (!Number.isFinite(v)) return dflt
  return Math.min(hi, Math.max(lo, v))
}

// Merge whatever is stored onto the defaults, coercing every field so a partial
// or hand-edited doc can never crash the editor or the screen.
export function normalizeScreenFx(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const c = r.celebrations && typeof r.celebrations === 'object' ? r.celebrations : {}
  const b = r.background && typeof r.background === 'object' ? r.background : {}
  const intensity = ['calm', 'normal', 'party'].includes(c.intensity) ? c.intensity : 'normal'
  const type = ['none', 'image', 'video'].includes(b.type) ? b.type : 'none'
  return {
    version: 1,
    accent: typeof r.accent === 'string' ? r.accent : '',
    celebrations: {
      enabled: c.enabled !== false,
      confetti: c.confetti !== false,
      messages: c.messages !== false,
      intensity,
    },
    background: {
      type,
      url: typeof b.url === 'string' ? b.url : '',
      opacity: clamp(b.opacity, 0, 1, 0.45),
      posX: clamp(b.posX, 0, 100, 50),
      posY: clamp(b.posY, 0, 100, 50),
      scale: clamp(b.scale, 1, 2.5, 1),
      blur: clamp(b.blur, 0, 24, 0),
      brightness: clamp(b.brightness, 0.4, 1.6, 1),
      contrast: clamp(b.contrast, 0.6, 1.6, 1),
      saturate: clamp(b.saturate, 0, 2, 1),
      tint: clamp(b.tint, -100, 100, 0),
    },
  }
}

// The exact style objects the background layer uses — the render side mirrors
// this so the wall looks like the preview.
export function buildBg(bg) {
  const filter = `blur(${bg.blur}px) brightness(${bg.brightness}) contrast(${bg.contrast}) saturate(${bg.saturate})`
  const media = {
    objectPosition: `${bg.posX}% ${bg.posY}%`,
    transform: `scale(${bg.scale})`,
    filter,
  }
  const t = Number(bg.tint) || 0
  const tint = t === 0 ? null : {
    background: t > 0 ? '#ff8a3d' : '#3d7bff',
    opacity: Math.min(0.5, (Math.abs(t) / 100) * 0.5),
    mixBlendMode: 'overlay',
  }
  return { layer: { opacity: bg.opacity }, media, tint }
}

// number formatting — Latin digits, always (hard repo rule).
const pct = (n) => `${Math.round(n * 100)}%`
const oneDp = (n) => (Math.round(n * 100) / 100).toString()

const ACCENT_SWATCHES = ['#e7c46a', '#0e7490', '#b45309', '#7c2d2d', '#166534', '#5b21b6', '#be185d', '#334155']

// ===========================================================================
// small building blocks
// ===========================================================================
function Slider({ label, value, min, max, step, onChange, fmt, disabled }) {
  return (
    <div className="sfx-field">
      <div className="sfx-flabel">
        <span>{label}</span>
        <span className="sfx-val sfx-num">{fmt ? fmt(value) : value}</span>
      </div>
      <input
        className="sfx-slider" type="range"
        min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

function Toggle({ on, onChange, title, sub, disabled }) {
  return (
    <label className={`sfx-toggle${disabled ? ' is-off' : ''}`}>
      <input type="checkbox" checked={!!on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="sfx-track" aria-hidden="true" />
      <span className="sfx-toggle-txt">
        <b>{title}</b>
        {sub ? <span>{sub}</span> : null}
      </span>
    </label>
  )
}

// ===========================================================================
// LIVE PREVIEW — a faithful 1920x1080 mock, scaled by a JS-measured factor.
// ===========================================================================
const CONFETTI_BY_INTENSITY = { calm: 10, normal: 16, party: 26 }
const DUR_BY_INTENSITY = { calm: 4.2, normal: 3.1, party: 2.2 }

function ScreenPreview({ fx, venue, ar }) {
  const wrapRef = useRef(null)
  const [scale, setScale] = useState(0.2)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width || el.clientWidth
      if (w) setScale(w / 1920)
    })
    ro.observe(el)
    setScale((el.clientWidth || 384) / 1920)
    return () => ro.disconnect()
  }, [])

  const accent = fx.accent || venue?.brandColor || venue?.themeColor || '#e7c46a'
  const bg = fx.background
  const built = useMemo(() => buildBg(bg), [bg])
  const cel = fx.celebrations

  // deterministic confetti field — seeded per intensity so it never reshuffles
  // on an unrelated slider drag.
  const confetti = useMemo(() => {
    const n = CONFETTI_BY_INTENSITY[cel.intensity] || 16
    const dur = DUR_BY_INTENSITY[cel.intensity] || 3.1
    const cols = ['#e7c46a', '#ef8f5a', '#5ac8ef', '#7ee081', '#ef5a8f', '#f5f2ea']
    return Array.from({ length: n }, (_, i) => ({
      left: (i * 61 + 13) % 100,
      delay: ((i * 37) % 100) / 100 * dur,
      dur: dur + ((i % 5) * 0.18),
      color: cols[i % cols.length],
      rot: (i * 53) % 360,
    }))
  }, [cel.intensity])

  const venueName = venue?.name || (ar ? 'مقهى نيمة' : 'Neema Cafe')
  const cheer = ar ? 'أحسنت! فوز رائع' : 'Brilliant win!'

  return (
    <div className="sfx-stage-wrap" ref={wrapRef} style={{ '--sfx-accent': accent }}>
      <div className="sfx-screen" style={{ '--sfx-scale': scale, '--sfx-accent': accent }}>
        {/* background layer */}
        <div className="sfx-bg">
          {bg.type !== 'none' && bg.url ? (
            <div style={{ position: 'absolute', inset: 0, ...built.layer }}>
              {bg.type === 'video' ? (
                <video className="sfx-bg-media" src={bg.url} style={built.media} autoPlay muted loop playsInline />
              ) : (
                <img className="sfx-bg-media" src={bg.url} alt="" style={built.media} />
              )}
              {built.tint ? <div className="sfx-bg-tint" style={built.tint} /> : null}
            </div>
          ) : null}
        </div>

        {/* brand bar */}
        <div className="sfx-mk-top">
          {venue?.logoUrl
            ? <img className="sfx-mk-logo" src={venue.logoUrl} alt="" />
            : <div className="sfx-mk-logo sfx-mk-logo-fallback">{(venueName[0] || 'N')}</div>}
          <span className="sfx-mk-venue">{venueName}</span>
          <span className="sfx-mk-spacer" />
          <span className="sfx-mk-live"><i />{ar ? 'بث مباشر' : 'LIVE'}</span>
        </div>

        {/* scoreboard: table ضد table */}
        <div className="sfx-mk-score">
          <div className="sfx-mk-seat is-turn">
            <div className="sfx-mk-seat-name">{ar ? 'طاولة 1' : 'Table 1'}</div>
            <div className="sfx-mk-seat-sub">{ar ? 'سامي' : 'Sami'}</div>
            <div className="sfx-mk-seat-num sfx-num">3</div>
            <div className="sfx-mk-seat-state">{ar ? 'دوره الآن' : 'Their turn'}</div>
          </div>
          <div className="sfx-mk-vs">
            <b>{ar ? 'ضد' : 'VS'}</b>
            <span>{ar ? 'الشطرنج' : 'Chess'}</span>
          </div>
          <div className="sfx-mk-seat">
            <div className="sfx-mk-seat-name">{ar ? 'طاولة 2' : 'Table 2'}</div>
            <div className="sfx-mk-seat-sub">{ar ? 'ليان' : 'Layan'}</div>
            <div className="sfx-mk-seat-num sfx-num">2</div>
            <div className="sfx-mk-seat-state" />
          </div>
        </div>

        {/* now playing */}
        <div className="sfx-mk-now">
          <span className="sfx-mk-now-l">{ar ? 'من يلعب الآن' : 'Now playing'}</span>
          <span className="sfx-mk-now-n">{ar ? 'سامي' : 'Sami'}</span>
        </div>

        {/* board silhouette + sample hands */}
        <div className="sfx-mk-stage">
          <div className="sfx-mk-board">
            <div className="sfx-mk-piece" style={{ top: 32, insetInlineStart: 32 }} />
            <div className="sfx-mk-piece" style={{ top: 32, insetInlineStart: 172 }} />
            <div className="sfx-mk-piece dark" style={{ bottom: 32, insetInlineEnd: 32 }} />
            <div className="sfx-mk-piece dark" style={{ bottom: 32, insetInlineEnd: 172 }} />
            <div className="sfx-mk-piece" style={{ top: 250, insetInlineStart: 250 }} />
            <div className="sfx-mk-hand">
              <div className="sfx-mk-card" /><div className="sfx-mk-card" /><div className="sfx-mk-card" />
            </div>
          </div>

          {/* celebration overlay — only when enabled, so the manager sees exactly
              what a win looks like */}
          {cel.enabled ? (
            <div className="sfx-mk-celebrate">
              {cel.confetti ? confetti.map((c, i) => (
                <span
                  key={i} className="sfx-mk-confetti"
                  style={{
                    left: `${c.left}%`, background: c.color,
                    animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s`,
                    transform: `rotate(${c.rot}deg)`,
                  }}
                />
              )) : null}
              {cel.messages ? (
                <div className="sfx-mk-cheer">
                  <Icon name="events" size={44} />
                  <span>{cheer}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// EDITOR
// ===========================================================================
export default function ScreenAppearance({ ar, tenantId, tenant, canEdit, onSave }) {
  const toast = useToast()
  const stored = useMemo(() => normalizeScreenFx(tenant?.screenFx), [tenant?.screenFx])
  const [fx, setFx] = useState(stored)
  const [baseline, setBaseline] = useState(() => JSON.stringify(stored))
  const [busy, setBusy] = useState(false)      // saving
  const [uploading, setUploading] = useState(false)
  const [libOpen, setLibOpen] = useState(false)

  // Refs so the sync effect can read the LATEST fx/baseline without re-running
  // on every keystroke — it must fire only when the stored doc changes.
  const fxRef = useRef(fx); fxRef.current = fx
  const baseRef = useRef(baseline); baseRef.current = baseline

  // If the tenant doc changes underneath us (another device, or our own save
  // echoing back) AND we have no unsaved edits, adopt it. Never clobber a
  // manager mid-drag.
  useEffect(() => {
    if (JSON.stringify(fxRef.current) === baseRef.current) {
      setFx(stored)
      setBaseline(JSON.stringify(stored))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored])

  const dirty = JSON.stringify(fx) !== baseline

  const setBg = (patch) => setFx((f) => ({ ...f, background: { ...f.background, ...patch } }))
  const setCel = (patch) => setFx((f) => ({ ...f, celebrations: { ...f.celebrations, ...patch } }))

  const venue = tenant || {}

  const pickFile = async (file) => {
    if (!file || !canEdit) return
    setUploading(true)
    try {
      const isVideo = (file.type || '').startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v|ogv)$/i.test(file.name || '')
      const url = isVideo
        ? await uploadFile(tenantId, file, 'screenfx')
        : await uploadImage(tenantId, file, 'screenfx')
      setBg({ type: isVideo ? 'video' : 'image', url })
    } catch (e) {
      toast.error(ar ? 'تعذّر رفع الملف' : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    if (!canEdit || busy || !dirty) return
    setBusy(true)
    try {
      await onSave(fx)
      setBaseline(JSON.stringify(fx))
    } catch (_) {
      // onSave surfaces its own toast
    } finally {
      setBusy(false)
    }
  }

  const reset = () => setFx(normalizeScreenFx(undefined))
  const discard = () => setFx(JSON.parse(baseline))

  const bg = fx.background
  const cel = fx.celebrations
  const hasMedia = bg.type !== 'none'

  return (
    <div className="sfx-wrap">
      {/* ---------------------------------------------------------- controls */}
      <div className="sfx-controls">
        {!canEdit && (
          <div className="sfx-card">
            <p className="sfx-hint">
              {ar
                ? 'أنت تشاهد المظهر الحالي فقط. تعديله يحتاج صلاحية الإعدادات.'
                : 'You are viewing the current look only. Editing needs the settings permission.'}
            </p>
          </div>
        )}

        {/* accent / frame colour */}
        <div className="sfx-card">
          <div className="sfx-card-t">
            <Icon name="palette" size={16} />
            <span className="sfx-grow">{ar ? 'لون الإطار والتمييز' : 'Frame & accent colour'}</span>
          </div>
          <p className="sfx-hint">
            {ar
              ? 'يلوّن إطار الشاشة وحدود الطاولة صاحبة الدور وأسماء اللاعبين المميزة.'
              : 'Colours the screen frame, the on-turn table border and the highlighted names.'}
          </p>
          <div className="sfx-swatches">
            {ACCENT_SWATCHES.map((c) => (
              <button
                key={c} type="button"
                className={`sfx-swatch${fx.accent === c ? ' active' : ''}`}
                style={{ background: c }} disabled={!canEdit}
                aria-label={c}
                onClick={() => setFx((f) => ({ ...f, accent: c }))}
              />
            ))}
            <input
              className="sfx-color-in" type="color" disabled={!canEdit}
              value={fx.accent || venue.brandColor || venue.themeColor || '#e7c46a'}
              onChange={(e) => setFx((f) => ({ ...f, accent: e.target.value }))}
              aria-label={ar ? 'لون مخصص' : 'Custom colour'}
            />
            <input
              className="input input-sm sfx-hex sfx-num" dir="ltr" disabled={!canEdit}
              placeholder="#e7c46a" value={fx.accent}
              onChange={(e) => setFx((f) => ({ ...f, accent: e.target.value }))}
            />
            <button
              type="button" className="btn btn-sm btn-outline" disabled={!canEdit}
              onClick={() => setFx((f) => ({ ...f, accent: '' }))}
            >{ar ? 'الافتراضي' : 'Default'}</button>
          </div>
        </div>

        {/* background */}
        <div className="sfx-card">
          <div className="sfx-card-t">
            <Icon name="image" size={16} />
            <span className="sfx-grow">{ar ? 'خلفية الشاشة' : 'Screen background'}</span>
          </div>

          <div className="sfx-seg" role="group">
            {[
              ['none', ar ? 'بلا خلفية' : 'None', 'close'],
              ['image', ar ? 'صورة' : 'Image', 'image'],
              ['video', ar ? 'فيديو' : 'Video', 'play'],
            ].map(([val, lbl, ic]) => (
              <button
                key={val} type="button" disabled={!canEdit}
                className={bg.type === val ? 'active' : ''}
                onClick={() => setBg({ type: val })}
              ><Icon name={ic} size={14} />{lbl}</button>
            ))}
          </div>

          {hasMedia && (
            <>
              <div className="sfx-media">
                {bg.url ? (
                  bg.type === 'video'
                    ? <video className="sfx-thumb" src={bg.url} muted playsInline />
                    : <img className="sfx-thumb" src={bg.url} alt="" />
                ) : (
                  <div className="sfx-thumb sfx-thumb-empty"><Icon name="image" size={22} /></div>
                )}
                <div className="sfx-actions">
                  <label className={`btn btn-sm btn-outline${canEdit ? '' : ' is-disabled'}`} style={{ cursor: canEdit ? 'pointer' : 'default' }}>
                    <Icon name="upload" size={14} /> {uploading ? (ar ? 'جارٍ الرفع…' : 'Uploading…') : (ar ? 'رفع ملف' : 'Upload')}
                    <input
                      type="file" style={{ display: 'none' }}
                      accept={bg.type === 'video' ? 'video/*' : 'image/*'}
                      disabled={!canEdit || uploading}
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pickFile(f) }}
                    />
                  </label>
                  <button type="button" className="btn btn-sm btn-outline" disabled={!canEdit} onClick={() => setLibOpen(true)}>
                    <Icon name="folder" size={14} /> {ar ? 'من المكتبة' : 'Library'}
                  </button>
                  {bg.url && (
                    <button type="button" className="btn btn-sm btn-outline" disabled={!canEdit} onClick={() => setBg({ url: '' })}>
                      <Icon name="close" size={14} /> {ar ? 'إزالة' : 'Remove'}
                    </button>
                  )}
                </div>
              </div>

              <Slider label={ar ? 'الشفافية' : 'Opacity'} value={bg.opacity} min={0} max={1} step={0.05} fmt={pct} disabled={!canEdit} onChange={(v) => setBg({ opacity: v })} />

              <div className="sfx-field">
                <div className="sfx-flabel"><span>{ar ? 'الموضع' : 'Position'}</span></div>
                <div className="sfx-pos" role="group" aria-label={ar ? 'موضع الخلفية' : 'Background position'}>
                  {[0, 50, 100].map((py) => [0, 50, 100].map((px) => (
                    <button
                      key={`${px}-${py}`} type="button" disabled={!canEdit}
                      className={bg.posX === px && bg.posY === py ? 'active' : ''}
                      aria-label={`${px} ${py}`}
                      onClick={() => setBg({ posX: px, posY: py })}
                    />
                  )))}
                </div>
              </div>

              <Slider label={ar ? 'التكبير' : 'Zoom'} value={bg.scale} min={1} max={2.5} step={0.05} fmt={(v) => `${oneDp(v)}x`} disabled={!canEdit} onChange={(v) => setBg({ scale: v })} />

              <div className="sfx-card-t" style={{ fontSize: 12.5, opacity: 0.85 }}>
                <Icon name="sparkles" size={14} /> {ar ? 'المرشّحات (على الخلفية فقط)' : 'Filters (background only)'}
              </div>
              <div className="sfx-grid2">
                <Slider label={ar ? 'ضبابية' : 'Blur'} value={bg.blur} min={0} max={24} step={1} fmt={(v) => `${v}px`} disabled={!canEdit} onChange={(v) => setBg({ blur: v })} />
                <Slider label={ar ? 'سطوع' : 'Brightness'} value={bg.brightness} min={0.4} max={1.6} step={0.05} fmt={pct} disabled={!canEdit} onChange={(v) => setBg({ brightness: v })} />
                <Slider label={ar ? 'تباين' : 'Contrast'} value={bg.contrast} min={0.6} max={1.6} step={0.05} fmt={pct} disabled={!canEdit} onChange={(v) => setBg({ contrast: v })} />
                <Slider label={ar ? 'تشبّع' : 'Saturation'} value={bg.saturate} min={0} max={2} step={0.05} fmt={pct} disabled={!canEdit} onChange={(v) => setBg({ saturate: v })} />
              </div>
              <Slider
                label={ar ? 'درجة الدفء (بارد ↔ دافئ)' : 'Tint (cool ↔ warm)'}
                value={bg.tint} min={-100} max={100} step={5}
                fmt={(v) => (v === 0 ? (ar ? 'محايد' : 'Neutral') : (v > 0 ? `+${v}` : `${v}`))}
                disabled={!canEdit} onChange={(v) => setBg({ tint: v })}
              />
            </>
          )}
          {!hasMedia && (
            <p className="sfx-hint">{ar ? 'الشاشة تعرض خلفية «المجلس» الافتراضية. اختر صورة أو فيديو لتخصيصها.' : 'The screen shows the default felt background. Pick an image or video to customise it.'}</p>
          )}
        </div>

        {/* celebrations */}
        <div className="sfx-card">
          <div className="sfx-card-t">
            <Icon name="events" size={16} />
            <span className="sfx-grow">{ar ? 'احتفالات الفوز والجولات' : 'Win & round celebrations'}</span>
          </div>
          <Toggle
            on={cel.enabled} disabled={!canEdit}
            title={ar ? 'تفعيل الاحتفالات' : 'Enable celebrations'}
            sub={ar ? 'رسائل تشجيع وقصاصات ورق عند فوز لاعب أو جولة.' : 'Encouragement lines + confetti when a player or round is won.'}
            onChange={(v) => setCel({ enabled: v })}
          />
          <Toggle
            on={cel.messages} disabled={!canEdit || !cel.enabled}
            title={ar ? 'رسائل التشجيع' : 'Encouragement messages'}
            sub={ar ? 'مثل «أحسنت! فوز رائع».' : 'e.g. "Brilliant win!".'}
            onChange={(v) => setCel({ messages: v })}
          />
          <Toggle
            on={cel.confetti} disabled={!canEdit || !cel.enabled}
            title={ar ? 'قصاصات الورق' : 'Confetti'}
            sub={ar ? 'انفجار احتفالي فوق الرقعة.' : 'A celebratory burst over the board.'}
            onChange={(v) => setCel({ confetti: v })}
          />
          <div className="sfx-field">
            <div className="sfx-flabel"><span>{ar ? 'الحماس' : 'Intensity'}</span></div>
            <div className="sfx-seg" role="group">
              {[
                ['calm', ar ? 'هادئ' : 'Calm'],
                ['normal', ar ? 'معتدل' : 'Normal'],
                ['party', ar ? 'حماسي' : 'Party'],
              ].map(([val, lbl]) => (
                <button
                  key={val} type="button" disabled={!canEdit || !cel.enabled}
                  className={cel.intensity === val ? 'active' : ''}
                  onClick={() => setCel({ intensity: val })}
                >{lbl}</button>
              ))}
            </div>
          </div>
        </div>

        {/* save bar */}
        {canEdit && (
          <div className="sfx-card">
            <div className="sfx-actions" style={{ justifyContent: 'flex-start' }}>
              <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={save}>
                <Icon name="check" size={15} /> {busy ? (ar ? 'يُحفظ…' : 'Saving…') : (ar ? 'حفظ المظهر' : 'Save appearance')}
              </button>
              {dirty && (
                <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={discard}>
                  {ar ? 'تراجع' : 'Discard'}
                </button>
              )}
              <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={reset}>
                <Icon name="reload" size={14} /> {ar ? 'استعادة الافتراضي' : 'Reset'}
              </button>
              <span className="sfx-grow" style={{ flex: '1 1 auto' }} />
              {dirty
                ? <span className="sfx-dirty">{ar ? 'تغييرات غير محفوظة' : 'Unsaved'}</span>
                : <span className="sfx-saved"><Icon name="check" size={12} /> {ar ? 'محفوظ' : 'Saved'}</span>}
            </div>
            <p className="sfx-hint">
              {ar
                ? 'يُطبّق فوراً على شاشات العرض التي تعرض مباراة أو بطولة مباشرة.'
                : 'Applies instantly to any display currently showing a live match or tournament.'}
            </p>
          </div>
        )}
      </div>

      {/* ----------------------------------------------------------- preview */}
      <div className="sfx-preview-col">
        <div className="sfx-preview-head">
          <b><Icon name="eye" size={14} style={{ verticalAlign: '-2px', marginInlineEnd: 4 }} />{ar ? 'معاينة مباشرة' : 'Live preview'}</b>
          <span><span className="sfx-live-dot" /> {ar ? 'تتحدّث فوراً' : 'Updates live'}</span>
        </div>
        <ScreenPreview fx={fx} venue={venue} ar={ar} />
        <p className="sfx-hint">
          {ar
            ? 'معاينة بمقياس 16:9 مطابقة لتلفزيون 1920×1080. الطاولات واللوحة نموذجية، والمباراة الحقيقية تحل محلها على الجدار.'
            : 'A 16:9 preview matching a 1920x1080 TV. The tables and board are samples, and the real live match replaces them on the wall.'}
        </p>
      </div>

      {libOpen && (
        <MediaLibrary
          open tenantId={tenantId} lang={ar ? 'ar' : 'en'}
          kind={bg.type === 'video' ? 'video' : 'image'}
          folder="screenfx"
          onClose={() => setLibOpen(false)}
          onPick={(url, item) => {
            const isVideo = item?.kind === 'video'
            setBg({ type: isVideo ? 'video' : 'image', url })
            setLibOpen(false)
          }}
        />
      )}
    </div>
  )
}
