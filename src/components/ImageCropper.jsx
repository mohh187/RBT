import { useState, useCallback, useEffect } from 'react'
import Cropper from 'react-easy-crop'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { fileToDataUrl, getCroppedBlob } from '../lib/cropImage.js'

// Pan + zoom + crop an image before upload. Outputs a fixed-size WebP blob.
// Pass `file` (new upload) OR `imageSrc` (edit an EXISTING image URL in place).
export default function ImageCropper({ file, imageSrc, aspect, output, title, hint, onClose, onCropped }) {
  const { t, lang } = useI18n()
  const [src, setSrc] = useState('')
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [areaPixels, setAreaPixels] = useState(null)
  const [busy, setBusy] = useState(false)

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
      const blob = await getCroppedBlob(src, areaPixels, output)
      onCropped(blob)
    } catch (_) {
      setBusy(false)
    }
  }

  const round = aspect === 1

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
        <div style={{ position: 'relative', width: '100%', height: 300, background: '#0c0c0d', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
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
      </div>
    </Sheet>
  )
}
