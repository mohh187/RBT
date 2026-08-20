import { useId } from 'react'
import '../styles/duotone.css'
import Icon from './Icon.jsx'
import { useI18n } from '../lib/i18n.jsx'
import {
  DUOTONE_PRESETS, DUOTONE_MAX_STOPS, DUOTONE_DEFAULT,
  rampTable, rampGradient, duotoneActive,
} from '../lib/duotone.js'

// The LIVE preview half of «تلوين»: one SVG filter that is mathematically the
// same function as the canvas bake in lib/duotone.js, so what the owner sees
// while dragging is exactly what gets written.
//
//   feColorMatrix   throws the colour away and keeps Rec.709 luminance
//   feComponentTransfer  paints that luminance through the colour ramp, one
//                        tableValues entry per stop, which IS piecewise linear
//                        interpolation and so matches the bake's lookup table
//   feComposite      arithmetic k2/k3 blends back toward the original by the
//                    intensity dial: k2*duotone + k3*source with k2+k3 = 1
//
// color-interpolation-filters="sRGB" is not optional. The SVG default is
// linearRGB, which would make the browser preview noticeably darker in the
// midtones than the canvas bake, and the owner would be tuning against a lie.
export function DuotoneFilterDef({ id, cfg }) {
  const table = rampTable(cfg?.colors)
  if (!table || !duotoneActive(cfg)) return null
  const amt = Math.max(0, Math.min(1, Number(cfg.intensity)))
  const join = (a) => a.map((v) => v.toFixed(4)).join(' ')
  return (
    <svg aria-hidden="true" focusable="false" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <filter id={id} colorInterpolationFilters="sRGB">
        <feColorMatrix
          type="matrix"
          result="gray"
          values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"
        />
        <feComponentTransfer in="gray" result="duo">
          <feFuncR type="table" tableValues={join(table.r)} />
          <feFuncG type="table" tableValues={join(table.g)} />
          <feFuncB type="table" tableValues={join(table.b)} />
        </feComponentTransfer>
        <feComposite
          in="duo"
          in2="SourceGraphic"
          operator="arithmetic"
          k1="0"
          k2={amt}
          k3={1 - amt}
          k4="0"
        />
      </filter>
    </svg>
  )
}

// A stable filter id + the css value to point at it, for a caller that wants to
// preview the effect on its own element.
export function useDuotoneFilter(cfg) {
  const raw = useId()
  const id = `dt${raw.replace(/[^a-zA-Z0-9]/g, '')}`
  return { id, css: duotoneActive(cfg) ? `url(#${id})` : 'none' }
}

// The picker. Presets first because that is how this gets used ninety percent
// of the time, then the exact colours for the venue that has a brand to match.
export default function DuotoneControls({ value, onChange, compact = false }) {
  const { lang } = useI18n()
  const ar = lang !== 'en'
  const cfg = { ...DUOTONE_DEFAULT, ...(value || {}) }
  const colors = cfg.colors && cfg.colors.length >= 2 ? cfg.colors : DUOTONE_DEFAULT.colors
  const set = (patch) => onChange({ ...cfg, colors, ...patch })
  const setColor = (i, hex) => set({ colors: colors.map((c, k) => (k === i ? hex : c)) })
  const activePreset = DUOTONE_PRESETS.find((p) => p.colors.join() === colors.join())

  return (
    <div className="dt-wrap">
      <label className="dt-head">
        <input
          type="checkbox"
          checked={!!cfg.on}
          onChange={(e) => set({ on: e.target.checked })}
        />
        <span>
          <strong>{ar ? 'تلوين الصورة' : 'Recolour'}</strong>
          <span className="xs faint">
            {ar
              ? 'يغيّر ألوان الصورة ويُبقي كل تفاصيلها: الظلال تأخذ اللون الأول والإضاءة اللون الأخير'
              : 'Recolours the photo and keeps every detail: shadows take the first colour, highlights the last'}
          </span>
        </span>
      </label>

      {cfg.on && (
        <>
          <div className="scroll-x dt-presets">
            {DUOTONE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`dt-preset${activePreset?.id === p.id ? ' on' : ''}`}
                aria-pressed={activePreset?.id === p.id}
                onClick={() => set({ colors: [...p.colors] })}
                title={ar ? p.ar : p.en}
              >
                <span className="dt-preset-ramp" style={{ background: rampGradient(p.colors) }} />
                <span className="xs">{ar ? p.ar : p.en}</span>
              </button>
            ))}
          </div>

          <div className="dt-stops">
            {colors.map((c, i) => (
              <span key={i} className="dt-stop">
                <input
                  type="color"
                  value={c}
                  onChange={(e) => setColor(i, e.target.value)}
                  aria-label={i === 0
                    ? (ar ? 'لون الظلال' : 'Shadow colour')
                    : i === colors.length - 1
                      ? (ar ? 'لون الإضاءة' : 'Highlight colour')
                      : (ar ? `لون وسيط ${i}` : `Mid colour ${i}`)}
                />
                {colors.length > 2 && (
                  <button
                    type="button"
                    className="dt-stop-x"
                    onClick={() => set({ colors: colors.filter((_, k) => k !== i) })}
                    aria-label={ar ? 'احذف هذا اللون' : 'Remove this colour'}
                  >
                    <Icon name="close" size={11} />
                  </button>
                )}
              </span>
            ))}
            {colors.length < DUOTONE_MAX_STOPS && (
              <button
                type="button"
                className="dt-stop-add"
                onClick={() => {
                  // a new stop lands in the MIDDLE, between the last two, which
                  // is where a third colour actually earns its place: a warm
                  // shadow, a mid tone and a cool highlight is what stops a
                  // recolour reading as a single-hue wash
                  const next = [...colors]
                  next.splice(next.length - 1, 0, colors[colors.length - 1])
                  set({ colors: next })
                }}
                title={ar ? 'أضف لوناً وسيطاً' : 'Add a mid colour'}
              >
                <Icon name="plus" size={13} />
              </button>
            )}
            <span className="dt-ramp" style={{ background: rampGradient(colors) }} />
          </div>

          <label className="dt-range">
            <span className="xs faint">
              {ar ? 'شدّة التلوين' : 'Strength'} {Math.round((Number(cfg.intensity) || 0) * 100)}%
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={cfg.intensity}
              onChange={(e) => set({ intensity: Number(e.target.value) })}
            />
          </label>

          {!compact && (
            <p className="xs faint" style={{ margin: 0 }}>
              {ar
                ? 'اللون يُدمج في الصورة عند الحفظ، فلا يُثقل جوال الضيف بشيء. والصورة الأصلية تبقى محفوظة'
                : 'The colour is baked in on save, so it costs a guest phone nothing. The original photo is kept'}
            </p>
          )}
        </>
      )}
    </div>
  )
}
