// «المائدة الحية» — the whole table previewed as one 3D scene.
//
// Every ordered dish that has a 3D model (uploaded .glb/.usdz or the generated
// AR standee) is arranged around a virtual table, so the party sees the full
// spread before confirming. Tapping one dish opens it in REAL camera AR.
//
// HONESTY (do not oversell this): browsers give no shared/anchored AR session.
// Each phone places the dish on its OWN table in its own camera view; the
// devices are not looking at the same virtual object. The in-app scene below is
// a genuine 3D preview, not a co-located AR session — the UI says so plainly.
import { useEffect, useMemo, useRef, useState } from 'react'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { Spinner } from './ui.jsx'

const MAX_MODELS = 6

// A dish is renderable when it carries a GLB (or a USDZ for iOS Quick Look).
function modelsOf(line) {
  const main = String(line?.model3dUrl || '')
  const isUsdzMain = /\.usdz($|\?)/i.test(main)
  const glb = isUsdzMain ? String(line?.arStandeeUrl || '') : (main || String(line?.arStandeeUrl || ''))
  const usdz = String(line?.model3dUsdzUrl || '') || (isUsdzMain ? main : '')
  return { glb, usdz }
}

export default function TableArScene({ open, onClose, lines = [], lang = 'ar' }) {
  const ar = lang === 'ar'
  const [state, setState] = useState('loading') // loading | ready | error
  const [solo, setSolo] = useState(null)
  const soloRef = useRef(null)
  const [arFailed, setArFailed] = useState(false)

  // <model-viewer> registers a custom element globally — load it once, lazily.
  useEffect(() => {
    if (!open) return undefined
    let alive = true
    setState('loading')
    import('../lib/ar3d.js')
      .then((m) => m.loadModelViewer())
      .then(() => { if (alive) setState('ready') })
      .catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [open])

  useEffect(() => { if (!open) { setSolo(null); setArFailed(false) } }, [open])

  // Escape closes the single-dish layer first, not the whole sheet. Captured at
  // the window so Sheet's own document-level handler never sees it.
  useEffect(() => {
    if (!solo) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setSolo(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [solo])

  // One tile per DISH (same dish ordered twice is one model with a count).
  const dishes = useMemo(() => {
    const byKey = new Map()
    ;(Array.isArray(lines) ? lines : []).forEach((l) => {
      const { glb, usdz } = modelsOf(l)
      if (!glb && !usdz) return
      const key = l?.itemId || glb || usdz
      if (byKey.has(key)) { byKey.get(key).qty += Number(l?.qty) || 1; return }
      byKey.set(key, {
        key,
        glb,
        usdz,
        qty: Number(l?.qty) || 1,
        nameAr: String(l?.nameAr || ''),
        nameEn: String(l?.nameEn || ''),
      })
    })
    return [...byKey.values()]
  }, [lines])

  const shown = dishes.slice(0, MAX_MODELS)
  const hidden = dishes.length - shown.length

  // Elliptical layout = a table seen at an angle: front dishes sit lower,
  // larger and above the back ones.
  const placeOf = (i, n) => {
    const angle = (-Math.PI / 2) + (i * 2 * Math.PI) / Math.max(1, n)
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const depth = (sin + 1) / 2 // 0 = back, 1 = front
    return {
      left: `${50 + cos * 31}%`,
      top: `${50 + sin * 20}%`,
      transform: `translate(-50%, -50%) scale(${(0.78 + depth * 0.32).toFixed(3)})`,
      zIndex: 10 + Math.round(depth * 20),
    }
  }

  const openSolo = (d) => { setArFailed(false); setSolo(d) }

  // Jump straight into camera AR. The viewer's own AR button stays available as
  // the fallback when the programmatic call is refused.
  const launchAr = () => {
    const el = soloRef.current
    if (!el) return
    try {
      const p = el.activateAR?.()
      if (p?.catch) p.catch(() => setArFailed(true))
    } catch (_) { setArFailed(true) }
  }

  const bindAr = (el) => {
    soloRef.current = el
    if (!el || el._rbtTarBound) return
    el._rbtTarBound = true
    el.addEventListener('ar-status', (e) => { if (e?.detail?.status === 'failed') setArFailed(true) })
  }

  const nameOf = (d) => ((!ar && d.nameEn) ? d.nameEn : (d.nameAr || d.nameEn));

  return (
    <Sheet open={open} onClose={onClose} title={ar ? 'المائدة الحية' : 'Live table'} tall>
      {state === 'loading' ? (
        <div className="tl-state"><Spinner lg /><p>{ar ? 'نحضّر مائدتك ثلاثية الأبعاد…' : 'Preparing your 3D table…'}</p></div>
      ) : state === 'error' ? (
        <div className="tl-state">
          <Icon name="warning" size={22} />
          <p>{ar ? 'تعذّر تحميل عارض المجسمات.' : 'Could not load the 3D viewer.'}</p>
          <p className="tl-note">{ar ? 'تحقق من الإنترنت ثم أعد فتح النافذة.' : 'Check your connection and reopen.'}</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="tl-state">
          <Icon name="layers" size={22} />
          <p>{ar ? 'لا يوجد مجسم ثلاثي الأبعاد لأصناف هذا الطلب.' : 'None of these items has a 3D model yet.'}</p>
          <p className="tl-note">{ar ? 'تظهر المائدة الحية فقط للأصناف التي رفع لها المطعم مجسماً أو أُنشئ لها مجسم تلقائي.' : 'The live table only shows dishes with an uploaded or generated 3D model.'}</p>
        </div>
      ) : (
        <div className="tar-wrap">
          <div className="tar-stage" aria-label={ar ? 'مائدة ثلاثية الأبعاد' : '3D table'}>
            <div className="tar-table" aria-hidden="true" />
            {shown.map((d, i) => (
              <div key={d.key} className="tar-slot" style={placeOf(i, shown.length)}>
                <model-viewer
                  src={d.glb || undefined}
                  ios-src={d.usdz || undefined}
                  camera-controls=""
                  auto-rotate=""
                  disable-zoom=""
                  shadow-intensity="1"
                  loading="eager"
                  reveal="auto"
                  style={{ width: '100%', height: '100%', background: 'transparent' }}
                />
                <span className="tar-tag">
                  {nameOf(d)}
                  {d.qty > 1 ? <b className="tar-qty">{d.qty}</b> : null}
                </span>
              </div>
            ))}
          </div>

          <div className="tar-list">
            {shown.map((d) => (
              <button key={d.key} type="button" className="btn ghost tar-btn" onClick={() => openSolo(d)}>
                <Icon name="camera" size={15} />
                <span className="grow">{nameOf(d)}</span>
                <span className="tar-btn-cta">{ar ? 'اعرضه على طاولتي' : 'Show on my table'}</span>
              </button>
            ))}
          </div>

          {hidden > 0 && (
            <p className="tl-note">
              {ar
                ? `عُرضت ${MAX_MODELS} أطباق فقط للحفاظ على سرعة الجهاز — و${hidden} أخرى لها مجسمات يمكن عرضها منفردة.`
                : `Only ${MAX_MODELS} dishes are shown to keep the device fast — ${hidden} more have models you can view individually.`}
            </p>
          )}

          <p className="tar-honesty">
            <Icon name="warning" size={13} />
            <span>
              {ar
                ? 'العرض المشترك على نفس الطاولة بين عدة أجهزة غير مدعوم في المتصفح — كل جهاز يعرض الطبق على طاولته.'
                : 'Sharing one anchored AR table across devices is not supported in the browser — each phone places the dish on its own table.'}
            </span>
          </p>
        </div>
      )}

      {solo && (
        <div className="tar-solo" role="dialog" aria-modal="true" aria-label={nameOf(solo)}>
          <div className="tar-solo-head">
            <strong className="grow">{nameOf(solo)}</strong>
            <button type="button" className="icon-btn" aria-label={ar ? 'إغلاق' : 'Close'} onClick={() => setSolo(null)}>
              <Icon name="close" size={18} />
            </button>
          </div>
          <div className="tar-solo-body">
            <model-viewer
              ref={bindAr}
              src={solo.glb || undefined}
              ios-src={solo.usdz || undefined}
              ar=""
              ar-modes="scene-viewer webxr quick-look"
              ar-scale="auto"
              camera-controls=""
              auto-rotate=""
              shadow-intensity="1"
              loading="eager"
              style={{ width: '100%', height: '100%', background: 'transparent' }}
            />
          </div>
          <div className="tar-solo-foot">
            <button className="btn primary tar-solo-ar" onClick={launchAr}>
              <Icon name="camera" size={16} /> {ar ? 'اعرضه على طاولتي' : 'Show on my table'}
            </button>
            <p className={`tl-note ${arFailed ? 'tar-fail' : ''}`}>
              {arFailed
                ? (ar
                  ? 'تعذر بدء الواقع المعزز على هذا الجهاز: على أندرويد ثبّت «Google Play Services for AR» وافتح الرابط في Chrome نفسه، وعلى آيفون افتح في Safari.'
                  : 'AR could not start: on Android install "Google Play Services for AR" and open in Chrome itself; on iPhone use Safari.')
                : (ar
                  ? 'وجّه الكاميرا إلى طاولتك — سيقف الطبق عليها بحجمه الحقيقي.'
                  : 'Point the camera at your table — the dish stands on it at real size.')}
            </p>
          </div>
        </div>
      )}
    </Sheet>
  )
}
