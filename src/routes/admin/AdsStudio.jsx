// «استوديو الإعلانات» — the venue designs an ad that greets guests inside the
// menu, and controls exactly when and to whom it appears.
//
// The numbers on this page are the raw counters the guest side wrote. Nothing
// is modelled, projected or estimated: with zero impressions the CTR column
// shows a dash, and `adProblems` names every reason an ad will not appear
// instead of letting a venue believe a broken campaign is running.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { watchItems, watchCategories, watchOffers } from '../../lib/db.js'
import {
  watchAds, saveAd, deleteAd, duplicateAd, blankAd, normalizeAd,
  adProblems, ctrOf, hasContent, AD_KINDS, AD_SHAPES, labelOf,
} from '../../lib/ads.js'
import AdShapePicker from '../../components/ads/AdShapePicker.jsx'
import AdCanvas from '../../components/ads/AdCanvas.jsx'
import AdTargeting from '../../components/ads/AdTargeting.jsx'
import AdSchedule from '../../components/ads/AdSchedule.jsx'
import AdReport from '../../components/ads/AdReport.jsx'
import AdRewardStep from '../../components/ads/AdRewardStep.jsx'
import AdPreview from '../../components/ads/AdPreview.jsx'
import '../../styles/ads.css'

const num = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')
const pct = (n) => `${Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 1 })}%`

const STEPS = [
  { id: 'shape', ar: 'الشكل', en: 'Shape', icon: 'shapes' },
  { id: 'design', ar: 'التصميم', en: 'Design', icon: 'palette' },
  { id: 'link', ar: 'الربط', en: 'Link', icon: 'share' },
  { id: 'when', ar: 'التوقيت والجدولة', en: 'Timing', icon: 'clock' },
  { id: 'reward', ar: 'المكافأة', en: 'Reward', icon: 'award' },
]

export default function AdsStudio() {
  const { lang } = useI18n()
  const ar = lang !== 'en'
  const { tenantId, tenant } = useAuth()
  const toast = useToast()

  const [list, setList] = useState(null)
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [offers, setOffers] = useState([])

  const [draft, setDraft] = useState(null)  // the ad being edited (normalized)
  const [editId, setEditId] = useState('')  // '' while creating
  const [view, setView] = useState('list')  // 'list' | 'report'
  const [step, setStep] = useState('shape')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!tenantId) return undefined
    const offs = [
      watchAds(tenantId, setList),
      watchItems(tenantId, setItems),
      watchCategories(tenantId, setCategories),
      watchOffers(tenantId, setOffers),
    ]
    return () => offs.forEach((f) => f?.())
  }, [tenantId])

  const rows = useMemo(() => (list || []).map(normalizeAd).filter(Boolean), [list])
  const problems = useMemo(() => (draft ? adProblems(draft) : []), [draft])

  const startNew = () => {
    setDraft(normalizeAd({ ...blankAd(), name: ar ? 'إعلان جديد' : 'New ad' }))
    setEditId('')
    setStep('shape')
  }

  const startEdit = (ad) => {
    setDraft(normalizeAd(ad))
    setEditId(ad.id)
    setStep('shape')
  }

  // `back` returns to the list after saving (the normal finish-and-review
  // flow), while «حفظ ومتابعة» keeps the editor open for a long design session.
  async function onSave({ back = true } = {}) {
    if (!draft || !tenantId) return
    if (!draft.name.trim()) { toast.error(ar ? 'اكتب اسماً للإعلان' : 'Name the ad'); return }
    setBusy(true)
    try {
      const payload = { ...draft }
      delete payload.id
      const id = await saveAd(tenantId, editId || null, payload)
      if (!editId && typeof id === 'string') setEditId(id)
      const inactive = !draft.active
      toast.success(inactive
        ? (ar ? 'حُفظ — فعّله من البطاقة ليظهر للعملاء' : 'Saved — activate it to go live')
        : (ar ? 'حُفظ الإعلان وهو نشط الآن' : 'Saved and live'))
      if (back) { setDraft(null); setEditId('') }
    } catch (e) {
      toast.error(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function onToggleActive(ad) {
    if (!tenantId) return
    // Refuse to activate an ad that provably cannot render — the venue would
    // otherwise watch an "active" campaign produce zero impressions forever.
    if (!ad.active && !hasContent(ad)) {
      toast.error(ar ? 'لا يمكن تفعيل إعلان بلا صورة ولا نص' : 'Cannot activate an empty ad')
      return
    }
    try {
      await saveAd(tenantId, ad.id, { active: !ad.active })
    } catch (e) {
      toast.error(String(e?.message || e))
    }
  }

  async function onDuplicate(ad) {
    try {
      await duplicateAd(tenantId, ad)
      toast.success(ar ? 'نُسخ الإعلان (موقوف وبعدّادات صفرية)' : 'Duplicated (paused, counters reset)')
    } catch (e) {
      toast.error(String(e?.message || e))
    }
  }

  async function onDelete(ad) {
    const ok = window.confirm(ar ? `حذف «${ad.name || 'إعلان'}» نهائياً؟` : 'Delete permanently?')
    if (!ok) return
    try {
      await deleteAd(tenantId, ad.id)
      if (editId === ad.id) { setDraft(null); setEditId('') }
      toast.success(ar ? 'حُذف' : 'Deleted')
    } catch (e) {
      toast.error(String(e?.message || e))
    }
  }

  // ---------------- the editor ----------------
  if (draft) {
    const shared = { ad: draft, onChange: setDraft, lang }
    return (
      <div className="ads-page">
        <div className="ads-head">
          <div>
            <h2>{editId ? (ar ? 'تعديل إعلان' : 'Edit ad') : (ar ? 'إعلان جديد' : 'New ad')}</h2>
            <p>{ar ? 'كل تغيير يظهر فوراً في المعاينة على اليمين.' : 'Every change shows in the preview.'}</p>
          </div>
          <div className="ads-row-btns">
            <button type="button" className="btn" onClick={() => { setDraft(null); setEditId('') }}>
              <Icon name="back" size={16} />
              {ar ? 'رجوع' : 'Back'}
            </button>
            <button type="button" className="btn" onClick={() => onSave({ back: false })} disabled={busy}>
              {ar ? 'حفظ ومتابعة' : 'Save & keep editing'}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onSave({ back: true })} disabled={busy}>
              {busy ? <Spinner /> : <Icon name="check" size={16} />}
              {ar ? 'حفظ وعرض الإعلانات' : 'Save & view ads'}
            </button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="ads-name">{ar ? 'اسم الإعلان (داخلي، لا يراه الضيف)' : 'Internal name'}</label>
          <input
            id="ads-name"
            className="input"
            value={draft.name}
            maxLength={80}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>

        {problems.length ? (
          <div className="ads-warn">
            <Icon name="warning" size={16} />
            <ul>
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
        ) : (
          <div className="ads-warn ok">
            <Icon name="ok" size={16} />
            <span>{ar ? 'الإعداد مكتمل — لا شيء يمنع ظهور هذا الإعلان.' : 'Nothing blocks this ad from showing.'}</span>
          </div>
        )}

        <div className="ads-steps">
          {STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`chip${step === s.id ? ' active' : ''}`}
              onClick={() => setStep(s.id)}
            >
              <Icon name={s.icon} size={15} />
              {ar ? s.ar : s.en}
            </button>
          ))}
        </div>

        <div className="ads-editor">
          <div className="card card-pad ads-panel">
            {step === 'shape' ? <AdShapePicker {...shared} /> : null}
            {step === 'design' ? (
              <AdCanvas {...shared} tenant={tenant} tenantId={tenantId} items={items} toast={toast} />
            ) : null}
            {step === 'link' ? (
              <AdTargeting {...shared} tenant={tenant} items={items} categories={categories} offers={offers} />
            ) : null}
            {step === 'when' ? <AdSchedule {...shared} /> : null}
            {step === 'reward' ? <AdRewardStep {...shared} /> : null}
          </div>

          <div className="ads-preview-col">
            <AdPreview ad={draft} lang={lang} />
          </div>
        </div>
      </div>
    )
  }

  // ---------------- the list ----------------
  return (
    <div className="ads-page">
      <div className="ads-head">
        <div>
          <h2>{ar ? 'استوديو الإعلانات' : 'Ads studio'}</h2>
          <p>
            {ar
              ? 'إعلان يستقبل الضيف داخل القائمة — أنت تحدد شكله ووقته ومن يراه.'
              : 'An ad that greets guests inside the menu.'}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={startNew}>
          <Icon name="add" size={16} />
          {ar ? 'إعلان جديد' : 'New ad'}
        </button>
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 12 }}>
        <button type="button" className={`chip ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>
          <Icon name="grid" size={13} /> {ar ? 'الإعلانات' : 'Ads'}
        </button>
        <button type="button" className={`chip ${view === 'report' ? 'active' : ''}`} onClick={() => setView('report')}>
          <Icon name="chartBar" size={13} /> {ar ? 'السجل والنتائج' : 'Results'}
        </button>
      </div>

      {view === 'report' ? (
        <AdReport
          tenantId={tenantId}
          ads={rows}
          lang={lang}
          onOpenAd={(ad) => { setDraft(normalizeAd(ad)); setEditId(ad.id); setView('list') }}
        />
      ) : null}

      {view === 'report' ? null : list === null ? <Spinner lg /> : null}

      {list !== null && !rows.length ? (
        <Empty
          icon="theater"
          title={ar ? 'لا توجد إعلانات بعد' : 'No ads yet'}
          hint={ar
            ? 'أنشئ أول إعلان واختر شكله ووقته والجمهور الذي يراه.'
            : 'Create your first ad and choose its shape, timing and audience.'}
          action={(
            <button type="button" className="btn btn-primary" onClick={startNew}>
              <Icon name="add" size={16} />
              {ar ? 'إعلان جديد' : 'New ad'}
            </button>
          )}
        />
      ) : null}

      {rows.length ? (
        <div className="ads-list">
          {rows.map((ad) => {
            const rate = ctrOf(ad)
            const issues = adProblems(ad)
            return (
              <div key={ad.id} className="card ads-item">
                <div className="ads-item-top">
                  <div className="ads-thumb" data-shape={ad.shape}>
                    {ad.media.type === 'image' && ad.media.url
                      ? <img src={ad.media.url} alt="" loading="lazy" />
                      : null}
                    {ad.media.type === 'video' && ad.media.url
                      ? <video src={ad.media.url} muted playsInline />
                      : null}
                    {ad.media.type === 'none' || !ad.media.url ? <Icon name="image" size={18} /> : null}
                  </div>
                  <div className="ads-item-name">
                    <b>{ad.name || (ar ? 'بلا اسم' : 'Untitled')}</b>
                    <span>
                      {`${labelOf(AD_KINDS, ad.kind)} — ${labelOf(AD_SHAPES, ad.shape)}`}
                    </span>
                  </div>
                  <span className={`badge ${ad.active ? 'badge-success' : ''}`}>
                    {ad.active ? (ar ? 'يعمل' : 'Live') : (ar ? 'موقوف' : 'Paused')}
                  </span>
                </div>

                {issues.length ? (
                  <div className="ads-warn">
                    <Icon name="warning" size={15} />
                    <span>{issues[0]}</span>
                  </div>
                ) : null}

                <div className="ads-stats">
                  <div className="ads-stat">
                    <b>{num(ad.stats.impressions)}</b>
                    <span>{ar ? 'ظهور' : 'Views'}</span>
                  </div>
                  <div className="ads-stat">
                    <b>{num(ad.stats.clicks)}</b>
                    <span>{ar ? 'ضغطات' : 'Clicks'}</span>
                  </div>
                  <div className="ads-stat">
                    {/* A dash, never a made-up rate, while nothing has been shown. */}
                    <b>{rate == null ? '—' : pct(rate)}</b>
                    <span>{ar ? 'نسبة الضغط' : 'CTR'}</span>
                  </div>
                </div>

                <div className="ads-row-btns">
                  <button type="button" className="btn btn-sm" onClick={() => startEdit(ad)}>
                    <Icon name="edit" size={15} />
                    {ar ? 'تحرير' : 'Edit'}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => onToggleActive(ad)}>
                    <Icon name={ad.active ? 'pause' : 'play'} size={15} />
                    {ad.active ? (ar ? 'إيقاف' : 'Pause') : (ar ? 'تفعيل' : 'Activate')}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => onDuplicate(ad)}>
                    <Icon name="copy" size={15} />
                    {ar ? 'نسخ' : 'Duplicate'}
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => onDelete(ad)}>
                    <Icon name="delete" size={15} />
                    {ar ? 'حذف' : 'Delete'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {rows.length ? (
        <p className="ads-hint">
          {ar
            ? 'الأرقام أعلاه عدّادات فعلية يكتبها جهاز الضيف عند كل ظهور أو ضغطة — لا تُقدَّر ولا تُستنتج. وهي إجمالية فقط: لا يوجد تفصيل بحسب اليوم أو الجهاز.'
            : 'These are real counters written by the guest device, never estimates.'}
        </p>
      ) : null}
    </div>
  )
}
