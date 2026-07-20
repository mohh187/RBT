// «الشكل» — how the ad occupies the screen (kind) and the silhouette of the ad
// body (shape). Every option draws a real miniature of a phone with the shape
// in place, so the venue picks by sight instead of by guessing a word.
import { AD_KINDS, AD_SHAPES } from '../../lib/ads.js'

function Option({ group, opt, active, onPick, lang }) {
  const ar = lang !== 'en'
  return (
    <button
      type="button"
      className={`ads-shape${active ? ' active' : ''}`}
      onClick={() => onPick(opt.id)}
      aria-pressed={active}
    >
      <span className="ads-mini" data-k={group === 'kind' ? opt.id : undefined} data-s={group === 'shape' ? opt.id : undefined}>
        <i />
      </span>
      <b>{ar ? opt.ar : opt.en}</b>
      {opt.hint && ar ? <span>{opt.hint}</span> : null}
    </button>
  )
}

export default function AdShapePicker({ ad, onChange, lang = 'ar' }) {
  const ar = lang !== 'en'
  return (
    <>
      <div>
        <h4>{ar ? 'مكان الظهور' : 'Placement'}</h4>
        <p className="ads-hint">
          {ar
            ? 'الشريط الإعلاني يترك القائمة قابلة للتصفح؛ ملء الشاشة أقوى أثراً لكنه يوقف الضيف تماماً.'
            : 'A banner keeps the menu usable; fullscreen stops the guest entirely.'}
        </p>
      </div>
      <div className="ads-shapes">
        {AD_KINDS.map((k) => (
          <Option
            key={k.id}
            group="kind"
            opt={k}
            lang={lang}
            active={ad.kind === k.id}
            onPick={(id) => onChange({ ...ad, kind: id })}
          />
        ))}
      </div>

      <div>
        <h4>{ar ? 'شكل الإعلان' : 'Ad shape'}</h4>
        <p className="ads-hint">
          {ar
            ? 'داخل الشريط الإعلاني تتحول كل الأشكال إلى صف مضغوط — الدائرة تبقى دائرة، والعريض يبقى عريضاً.'
            : 'Inside a banner every shape collapses to a compact row.'}
        </p>
      </div>
      <div className="ads-shapes">
        {AD_SHAPES.map((s) => (
          <Option
            key={s.id}
            group="shape"
            opt={s}
            lang={lang}
            active={ad.shape === s.id}
            onPick={(id) => onChange({ ...ad, shape: id })}
          />
        ))}
      </div>

      {ad.shape === 'circle' ? (
        <p className="ads-hint">
          {ar
            ? 'الشكل الدائري يضع النص في المنتصف دائماً مهما كان اختيار «موضع النص»، لأن أعلى الدائرة وأسفلها ضيقان.'
            : 'The circle always centres its text — its top and bottom are too narrow for anything else.'}
        </p>
      ) : null}
    </>
  )
}
