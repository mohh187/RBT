import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase.js'
import { useI18n } from '../lib/i18n.jsx'
import { useToast } from './Toast.jsx'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { Spinner } from './ui.jsx'
import { loadModelViewer } from '../lib/ar3d.js'
import { uploadFile } from '../lib/storage.js'
import ItemFx from './ItemFx.jsx'

// Full-screen studio for ONE item's 3D model: inspect it (orbit, exposure,
// environment, camera reset, AR), see a customer phone-frame preview, and act on
// it — regenerate from the photo, replace with an uploaded GLB/USDZ, remove, or
// download. HONESTY: there is no true mesh-editing API, so we never fake an
// editor — regenerate/replace/remove IS the real scope, and the UI says so.
//
// Props: { open, onClose, tenantId, item, onChange } — onChange(patch) is called
// with only the changed keys; the parent persists (updateDoc) and syncs state.
export default function ModelStudio({ open, onClose, tenantId, item, onChange }) {
  const { lang } = useI18n()
  const toast = useToast()
  const ar = lang === 'ar'
  const [mv, setMv] = useState('loading') // loading | ready | error
  const [autoRotate, setAutoRotate] = useState(true)
  const [exposure, setExposure] = useState(1)
  const [env, setEnv] = useState('neutral') // model-viewer environment-image keyword
  const [resetKey, setResetKey] = useState(0) // remounts the viewer => camera reset
  const [uploadBusy, setUploadBusy] = useState(false)
  const [regenSec, setRegenSec] = useState(-1) // -1 idle, >=0 running (elapsed s)
  // Surfaced honestly instead of a silently-blank stage: model-viewer emits an
  // 'error' CustomEvent when the GLB fails to fetch/parse (bad URL, CORS, …).
  const [modelErr, setModelErr] = useState(false)
  const bindViewer = (el) => {
    if (!el || el._rbtErrBound) return
    el._rbtErrBound = true
    el.addEventListener('error', () => setModelErr(true))
    el.addEventListener('load', () => setModelErr(false))
  }

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    loadModelViewer().then(() => { if (alive) setMv('ready') }).catch(() => { if (alive) setMv('error') })
    return () => { alive = false }
  }, [open])

  useEffect(() => {
    if (regenSec < 0) return undefined
    const iv = setInterval(() => setRegenSec((s) => (s >= 0 ? s + 1 : s)), 1000)
    return () => clearInterval(iv)
  }, [regenSec >= 0]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !item) return null

  // model-viewer renders GLB inline; a .usdz main model goes to ios-src (Quick
  // Look) with the standee (if any) as the inline stand-in — same as the menu.
  const model = item.model3dUrl || ''
  const isUsdz = /\.usdz($|\?)/i.test(model)
  const glb = isUsdz ? (item.arStandeeUrl || '') : (model || item.arStandeeUrl || '')
  const usdz = isUsdz ? model : ''
  const hasModel = !!(glb || usdz)
  const downloadUrl = model || item.arStandeeUrl || ''
  const busy = uploadBusy || regenSec >= 0

  const regen = async () => {
    if (busy) return
    if (!item.imageUrl) { toast.error(ar ? 'لا توجد صورة للصنف — أضف صورة أولاً' : 'Add a photo to the item first'); return }
    if (!window.confirm(ar ? 'إعادة التوليد ستستبدل المجسم الحالي، وقد تستغرق من 1 إلى 8 دقائق. متابعة؟' : 'Regenerating replaces the current model and can take 1-8 minutes. Continue?')) return
    setRegenSec(0)
    try {
      const res = await httpsCallable(functions, 'imageTo3d', { timeout: 540000 })({ tenantId, itemId: item.id || '', imageUrl: item.imageUrl })
      const url = res?.data?.url
      if (!url) throw new Error(ar ? 'لم يصل رابط المجسم' : 'No model URL returned')
      onChange?.({ model3dUrl: url })
      toast.success(ar ? 'اكتمل المجسم الجديد' : 'New model ready')
    } catch (e) {
      toast.error(String(e?.message || e))
    } finally { setRegenSec(-1) }
  }

  const onPickModel = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f || busy) return
    if (!/\.(glb|usdz)$/i.test(f.name)) { toast.error(ar ? 'الملف يجب أن يكون .glb أو .usdz' : 'Must be .glb or .usdz'); return }
    setUploadBusy(true)
    try {
      const url = await uploadFile(tenantId, f, 'library/ar')
      onChange?.({ model3dUrl: url })
      toast.success(ar ? 'رُفع النموذج البديل' : 'Replacement model uploaded')
    } catch (err) {
      toast.error(err?.message || (ar ? 'تعذّر الرفع' : 'Upload failed'))
    } finally { setUploadBusy(false) }
  }

  const removeModel = () => {
    if (busy) return
    if (!window.confirm(ar ? 'إزالة المجسم الواقعي من هذا الصنف؟ (يبقى ملفه في المكتبة ويمكن رفعه من جديد)' : 'Remove the realistic model from this item?')) return
    onChange?.({ model3dUrl: '' })
    toast.success(ar ? 'أُزيل المجسم من الصنف' : 'Model removed from the item')
  }

  return (
    <Sheet
      open onClose={onClose} full
      title={(ar ? 'استوديو المجسم — ' : 'Model studio — ') + (ar ? (item.nameAr || item.nameEn || '') : (item.nameEn || item.nameAr || ''))}
    >
      <div className="ms-grid">
        <div className="ms-stage" style={{ position: 'relative' }}>
          {mv === 'loading' && <div className="center" style={{ minHeight: 280 }}><Spinner /></div>}
          {mv === 'error' && <p className="small" style={{ padding: 24, textAlign: 'center' }}>{ar ? 'تعذر تحميل عارض المجسمات — تحقق من اتصالك ثم أعد المحاولة.' : 'Could not load the 3D viewer — check your connection.'}</p>}
          {mv === 'ready' && hasModel && (
            <model-viewer
              ref={bindViewer}
              key={`main-${resetKey}`}
              src={glb || undefined}
              ios-src={usdz || undefined}
              ar=""
              ar-modes="scene-viewer webxr quick-look"
              ar-scale="auto"
              camera-controls=""
              auto-rotate={autoRotate ? '' : undefined}
              exposure={String(exposure)}
              environment-image={env}
              shadow-intensity="1"
              interaction-prompt="none"
              style={{ width: '100%', height: '100%', minHeight: 'inherit' }}
            />
          )}
          {mv === 'ready' && hasModel && !modelErr && <ItemFx kind={item.effect} scale={1.35} />}
          {mv === 'ready' && hasModel && modelErr && (
            <div className="ms-empty">
              <div className="card card-pad stack text-center" style={{ maxWidth: 340, gap: 8, borderColor: 'var(--danger)' }}>
                <Icon name="warning" size={26} style={{ color: 'var(--danger)', marginInline: 'auto' }} />
                <strong className="small">{ar ? 'تعذر تحميل ملف المجسم' : 'The model file failed to load'}</strong>
                <p className="xs faint" style={{ margin: 0, lineHeight: 1.7 }}>
                  {ar ? 'أعد المحاولة بزر «إعادة الكاميرا». إن استمر الخطأ فالملف تالف أو محجوب (CORS على حاوية التخزين) — أعد التوليد أو ارفع ملفاً بديلاً.' : 'Retry via camera reset. If it persists the file is corrupt or blocked (storage CORS) — regenerate or upload a replacement.'}
                </p>
                <a className="btn btn-sm btn-outline" href={glb || usdz} target="_blank" rel="noreferrer" style={{ marginInline: 'auto' }}>{ar ? 'افتح رابط الملف للفحص' : 'Open the file URL'}</a>
              </div>
            </div>
          )}
          {mv === 'ready' && !hasModel && (
            <div className="ms-empty">
              <div className="card card-pad stack text-center" style={{ maxWidth: 340, gap: 8 }}>
                <Icon name="shapes" size={30} className="faint" style={{ marginInline: 'auto' }} />
                <strong className="small">{ar ? 'لا يوجد مجسم لهذا الصنف بعد' : 'No model for this item yet'}</strong>
                <p className="xs faint" style={{ margin: 0, lineHeight: 1.7 }}>
                  {ar ? 'ولّد مجسماً واقعياً من صورة الصنف بالأزرار المجاورة، أو ارفع ملف GLB جاهزاً — وسيظهر هنا فوراً.' : 'Generate a realistic model from the item photo, or upload a GLB — it appears here instantly.'}
                </p>
              </div>
            </div>
          )}
          <div className="ms-ctrl">
            <button type="button" className={`chip ${autoRotate ? 'active' : ''}`} onClick={() => setAutoRotate((v) => !v)}>
              <Icon name="reload" size={13} /> {ar ? 'دوران تلقائي' : 'Auto-rotate'}
            </button>
            <span className="field-inline">
              {ar ? 'الإضاءة' : 'Exposure'}
              <input type="range" min="0.2" max="2" step="0.05" value={exposure} onChange={(e) => setExposure(Number(e.target.value))} />
              <span className="num faint">{exposure.toFixed(2)}</span>
            </span>
            <span className="field-inline">
              {ar ? 'البيئة' : 'Environment'}
              <select className="select" style={{ width: 'auto', padding: '4px 26px 4px 8px' }} value={env} onChange={(e) => setEnv(e.target.value)}>
                <option value="neutral">{ar ? 'محايدة (استوديو)' : 'Neutral (studio)'}</option>
                <option value="legacy">{ar ? 'كلاسيكية دافئة' : 'Legacy (warm)'}</option>
              </select>
            </span>
            <button type="button" className="chip" onClick={() => setResetKey((k) => k + 1)}>
              <Icon name="undo" size={13} /> {ar ? 'إعادة الكاميرا' : 'Reset camera'}
            </button>
          </div>
        </div>

        <div className="ms-side stack" style={{ gap: 'var(--sp-3)' }}>
          <strong className="small">{ar ? 'كيف يظهر للعميل' : 'Customer preview'}</strong>
          <div className="ms-phone" style={{ position: 'relative' }}>
            {mv === 'ready' && hasModel && <ItemFx kind={item.effect} />}
            {mv === 'ready' && hasModel ? (
              <model-viewer
                key={`mini-${resetKey}`}
                src={glb || undefined}
                ios-src={usdz || undefined}
                auto-rotate=""
                disable-zoom=""
                interaction-prompt="none"
                exposure={String(exposure)}
                environment-image={env}
                shadow-intensity="1"
              />
            ) : (
              <div className="center" style={{ height: '100%' }}><Icon name="shapes" size={26} className="faint" /></div>
            )}
          </div>
          <p className="xs faint" style={{ margin: 0 }}>
            {ar
              ? 'زر AR داخل العارض يعمل من الجوال، أما العرض على الطاولة فيفتحه العميل من المنيو مباشرة عبر «اعرضه على طاولتك».'
              : 'The AR button works on mobile — on-table AR opens from the customer menu itself.'}
          </p>

          <div className="stack" style={{ gap: 8 }}>
            <button type="button" className="btn btn-sm btn-outline" disabled={busy || !item.imageUrl} onClick={regen}
              title={ar ? 'يعيد توليد المجسم الواقعي من صورة الصنف (يستبدل الحالي، 1-8 دقائق)' : 'Regenerate from the item photo (replaces the current model)'}>
              <Icon name="sparkles" size={14} /> {regenSec >= 0 ? (ar ? `يعيد التوليد… ${regenSec} ث` : `Regenerating… ${regenSec}s`) : (ar ? 'إعادة التوليد من الصورة' : 'Regenerate from photo')}
            </button>
            <label className="btn btn-sm btn-outline" style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              <Icon name="upload" size={14} /> {uploadBusy ? (ar ? 'يرفع…' : 'Uploading…') : (ar ? 'رفع GLB بديل' : 'Upload replacement GLB')}
              <input type="file" accept=".glb,.usdz" hidden onChange={onPickModel} disabled={busy} />
            </label>
            {downloadUrl && (
              <a className="btn btn-sm btn-outline" href={downloadUrl} target="_blank" rel="noreferrer" download>
                <Icon name="download" size={14} /> {ar ? 'تنزيل الملف' : 'Download file'}
              </a>
            )}
            {item.model3dUrl && (
              <button type="button" className="btn btn-sm btn-outline" style={{ color: 'var(--danger)' }} disabled={busy} onClick={removeModel}>
                <Icon name="delete" size={14} /> {ar ? 'إزالة المجسم' : 'Remove model'}
              </button>
            )}
          </div>

          <p className="xs faint" style={{ margin: 0 }}>
            {ar
              ? 'التحرير الدقيق للشبكة غير متاح — يمكنك إعادة التوليد أو رفع نموذج معدل.'
              : 'Fine mesh editing is not available — regenerate, or upload an edited model.'}
          </p>
        </div>
      </div>
    </Sheet>
  )
}
