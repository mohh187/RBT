import { useState, useCallback, useEffect } from 'react'
import Cropper from 'react-easy-crop'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { fileToDataUrl, getCroppedBlob } from '../lib/cropImage.js'
import DuotoneControls, { DuotoneFilterDef, useDuotoneFilter } from './DuotoneControls.jsx'
import { DUOTONE_DEFAULT, bakeDuotone, duotoneActive } from '../lib/duotone.js'

// Pan + zoom + crop an image before upload. Outputs a WebP blob.
// Pass `file` (new upload) OR `imageSrc` (edit an EXISTING image URL in place).
//
// SHAPE IS EXPLICIT, NOT INFERRED. This used to draw a ROUND crop whenever the
// aspect happened to be 1, so every square dish photo came out as a circle —
// right for an avatar, wrong for food. Pass shape="round" when you actually
// want a circle.
//
// RATIO IS THE VENUE'S CHOICE. Different menu themes want different shapes (the
// editorial theme wants a wide cutout, cards want square, a hero wants tall), so
// unless a caller pins `aspect`, the ratio can be switched right here — and the
// output resolution follows the chosen ratio instead of squashing into a fixed
// box.
const RATIOS = [
  { id: 'square', ar: 'مربّع', en: 'Square', v: 1, w: 1000, h: 1000 },
  { id: 'wide', ar: 'عريض', en: 'Wide', v: 16 / 9, w: 1600, h: 900 },
  { id: 'photo', ar: 'صورة', en: 'Photo', v: 4 / 3, w: 1440, h: 1080 },
  { id: 'tall', ar: 'طولي', en: 'Tall', v: 3 / 4, w: 1080, h: 1440 },
  { id: 'story', ar: 'ستوري', en: 'Story', v: 9 / 16, w: 900, h: 1600 },
  { id: 'free', ar: 'حر', en: 'Free', v: null, w: 1600, h: 1600 },
]

// RECOLOUR LIVES HERE, and that is the whole reason it reaches the venue's
// wall, its table, its categories, its dishes and its stories at once: this
// component is the single gate every one of those images already passes through
// on its way to Storage. `recolor={false}` opts a surface out.
export default function ImageCropper({ file, imageSrc, aspect, output, title, hint, shape, onClose, onCropped, recolor = true, duotone = null }) {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const locked = typeof aspect === 'number'
  const [ratioId, setRatioId] = useState(() => {
    if (!locked) return 'square'
    const hit = RATIOS.find((r) => r.v && Math.abs(r.v - aspect) < 0.01)
    return hit ? hit.id : 'square'
  })
  const ratio = RATIOS.find((r) => r.id === ratioId) || RATIOS[0]
  const [src, setSrc] = useState('')
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [areaPixels, setAreaPixels] = useState(null)
  const [busy, setBusy] = useState(false)
  // `duotone` seeds the picker so re-opening an already recoloured image starts
  // from the colours it was given, rather than from the defaults.
  const [duo, setDuo] = useState(() => ({ ...DUOTONE_DEFAULT, ...(duotone || {}) }))
  const dtf = useDuotoneFilter(duo)

  useEffect(() => {
    let alive = true
    if (imageSrc) { setSrc(imageSrc); return () => { alive = false } }
    if (file) fileToDataUrl(file).then((d) => alive && setSrc(d))
    return () => { alive = false }
  }, [file, imageSrc])

  const onComplete = useCallback((_, areaPx) => setAreaPixels(areaPx), [])

  const confirm = async () => {
    if (!areaPixels) return
    setBusy(true)
    try {
      // Honour the caller's fixed output when it pinned one; otherwise size the
      // export to the ratio the venue picked, so a wide crop exports wide.
      const size = output || { width: ratio.w, height: ratio.h }
      // Pass the SHAPE the venue was shown. Omitting it is what made the round
      // viewport a lie: the preview was a circle and the saved file a square.
      const blob = await getCroppedBlob(src, areaPixels, size, { round: shape === 'round' })
      // BAKED, not applied at runtime. An SVG filter would stay editable
      // forever, but the table paints once per menu section and a filter forces
      // an offscreen buffer per filtered element, which is the exact class of
      // per-section cost that was killing guests' phones. One canvas pass here,
      // on a desktop, once, costs a guest nothing. The untouched original stays
      // in Storage either way, because every upload writes a new path.
      const out = recolor ? await bakeDuotone(blob, duo) : blob
      // second argument: the config that produced it, so a caller that stores it
      // can re-open this picker on the colours the owner actually chose
      onCropped(out, recolor && duotoneActive(duo) ? duo : null)
    } catch (_) {
      setBusy(false)
    }
  }

  const round = shape === 'round'
  const effAspect = locked ? aspect : (ratio.v || undefined)

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button className="btn btn-outline grow" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary grow" disabled={busy || !areaPixels} onClick={confirm}>{busy ? t('saving') : t('save')}</button>
        </div>
      }
    >
      <div className="stack">
        {hint && <p className="xs faint text-center">{hint}</p>}
        {!locked && (
          <div className="scroll-x" style={{ display: 'flex', gap: 6, paddingBottom: 2 }}>
            {RATIOS.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`chip${r.id === ratioId ? ' on' : ''}`}
                style={{ flex: 'none' }}
                aria-pressed={r.id === ratioId}
                onClick={() => { setRatioId(r.id); setZoom(1); setCrop({ x: 0, y: 0 }) }}
              >
                {ar ? r.ar : r.en}
              </button>
            ))}
          </div>
        )}
        {recolor && <DuotoneFilterDef id={dtf.id} cfg={duo} />}
        <div
          className={recolor ? 'crop-duo' : undefined}
          style={{ position: 'relative', width: '100%', height: 300, background: '#0c0c0d', borderRadius: 'var(--r-md)', overflow: 'hidden', '--dt-f': dtf.css }}
        >
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={effAspect}
              cropShape={round ? 'round' : 'rect'}
              showGrid={!round}
              restrictPosition
              zoomWithScroll
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onComplete}
            />
          )}
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <Icon name="search" size={16} className="faint" />
          <input
            type="range"
            min={1}
            max={3}
            step={0.02}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--brand)', height: 32 }}
            aria-label="zoom"
          />
        </div>
        <p className="xs faint text-center">{lang === 'ar' ? 'اسحب لتحريك الصورة · مرّر الشريط للتكبير/التصغير' : 'Drag to move · slide to zoom'}</p>
        {recolor && <DuotoneControls value={duo} onChange={setDuo} />}
      </div>
    </Sheet>
  )
}
