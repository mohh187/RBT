// «التصميم» — media, words and colours.
//
// The AI here is honest by construction: the image generator is handed the
// venue's OWN product photos and identity (postGen.generatePostImage with the
// real tenant + itemImageUrls), and every failure is shown as the real error
// message rather than swallowed into a shrug.
import { useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { Spinner } from '../ui.jsx'
import MediaLibrary from '../MediaLibrary.jsx'
import { uploadFile, uploadImage, UPLOAD_LIMITS_MB } from '../../lib/storage.js'
import { generatePostImage } from '../../lib/postGen.js'
import { aiQuick } from '../../lib/aiBridge.js'
import { FONT_OPTIONS } from '../../lib/skins.js'
import { TEXT_POSITIONS } from '../../lib/ads.js'
import { lex, venueAiContext } from '../../lib/venueTypes.js'
import { contrastRatio } from '../../lib/contrast.js'

const num = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')

// Strip the two things the brand guard forbids, in case the model emits them.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE0F}]/gu
const AR_DIGITS_RE = new RegExp(String.fromCharCode(91, 1632, 45, 1641, 1776, 45, 1785, 93), 'g')
const clean = (s) => String(s || '')
  .replace(EMOJI_RE, '')
  .replace(AR_DIGITS_RE, (ch) => {
    const c = ch.charCodeAt(0)
    return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660)
  })
  .trim()

export default function AdCanvas({ ad, onChange, tenant, tenantId, items = [], lang = 'ar', toast }) {
  const ar = lang !== 'en'
  const fileRef = useRef(null)
  const [lib, setLib] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [stylePrompt, setStylePrompt] = useState('')

  const top = (patch) => onChange({ ...ad, ...patch })
  const design = (patch) => onChange({ ...ad, design: { ...ad.design, ...patch } })
  const media = (patch) => onChange({ ...ad, media: { ...ad.media, ...patch } })

  // Real readability check on the venue's own colours — a warning it can act on.
  const textRatio = contrastRatio(ad.design.textColor, ad.design.bg)
  const textWeak = textRatio != null && textRatio < 3

  async function onFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || !tenantId) return
    const isVideo = (f.type || '').startsWith('video/')
    setErr('')
    setBusy('upload')
    try {
      const url = isVideo
        ? await uploadFile(tenantId, f, 'ads')
        : await uploadImage(tenantId, f, 'ads')
      media({ type: isVideo ? 'video' : 'image', url })
    } catch (e2) {
      const msg = String(e2?.message || e2)
      setErr(msg)
      toast?.error(msg)
    } finally {
      setBusy('')
    }
  }

  // The venue's real product photos drive the image, and `section` puts the
  // result in «سجل التوليد» like every other generator in the product.
  async function genImage() {
    if (!stylePrompt.trim()) {
      const m = ar ? 'اكتب وصف المشهد أولاً' : 'Describe the scene first'
      setErr(m); toast?.error(m); return
    }
    setErr('')
    setBusy('image')
    try {
      const itemImageUrls = (items || []).map((i) => i.imageUrl).filter(Boolean).slice(0, 3)
      const blob = await generatePostImage({
        tenant,
        itemImageUrls,
        stylePrompt: stylePrompt.trim(),
        venueName: tenant?.name || '',
        section: 'ads-studio',
      })
      const file = new File([blob], `ad-${Date.now()}.png`, { type: blob.type || 'image/png' })
      const url = await uploadImage(tenantId, file, 'ads')
      media({ type: 'image', url })
      toast?.success(ar ? 'أُنشئت الصورة' : 'Image generated')
    } catch (e2) {
      const msg = String(e2?.message || e2)
      setErr(msg)
      toast?.error(msg)
    } finally {
      setBusy('')
    }
  }

  async function genCopy() {
    setErr('')
    setBusy('text')
    try {
      const word = lex(tenant, 'item')
      const prompt = [
        'أنت كاتب إعلانات سعودي محترف.',
        `سياق المنشأة: ${venueAiContext(tenant)}`,
        stylePrompt.trim() ? `موضوع الإعلان: ${stylePrompt.trim()}.` : '',
        ad.headline ? `العنوان الحالي (حسّنه بدل استبداله إن كان جيداً): ${ad.headline}` : '',
        `اكتب نص إعلان منبثق يظهر للضيف فور فتح القائمة، ويتحدث عن «${word}» بمفردات هذا النشاط تحديداً.`,
        'أعد ثلاثة أسطر فقط بهذا الترتيب وبدون أي شرح أو ترقيم:',
        'السطر الأول: عنوان قصير جداً لا يتجاوز ست كلمات.',
        'السطر الثاني: جملة توضيحية واحدة لا تتجاوز خمس عشرة كلمة.',
        'السطر الثالث: نص زر الإجراء، كلمتان أو ثلاث على الأكثر.',
        'لا تعد بأي خصم أو هدية أو نقاط لم تُذكر لك صراحة.',
        'ممنوع منعاً باتاً: الرموز التعبيرية، والأرقام العربية المشرقية — الأرقام اللاتينية فقط.',
      ].filter(Boolean).join('\n')
      const out = await aiQuick(prompt, { logAs: { tid: tenantId, kind: 'text', section: 'ads-studio' } })
      const lines = clean(out).split('\n').map((l) => l.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean)
      if (!lines.length) throw new Error(ar ? 'لم يصل رد من الذكاء — أعد المحاولة.' : 'No reply from the model.')
      top({
        headline: lines[0]?.slice(0, 120) || ad.headline,
        body: lines[1]?.slice(0, 400) || ad.body,
        ctaLabel: lines[2]?.slice(0, 40) || ad.ctaLabel,
      })
      toast?.success(ar ? 'كُتب النص' : 'Copy written')
    } catch (e2) {
      const msg = String(e2?.message || e2)
      setErr(msg)
      toast?.error(msg)
    } finally {
      setBusy('')
    }
  }

  const hasMedia = ad.media.type !== 'none' && !!ad.media.url

  return (
    <>
      <div>
        <h4>{ar ? 'الوسيط' : 'Media'}</h4>
        <p className="ads-hint">
          {ar
            ? `صورة حتى ${num(UPLOAD_LIMITS_MB.image)}MB أو فيديو حتى ${num(UPLOAD_LIMITS_MB.video)}MB. الفيديو يعمل صامتاً ومكرراً.`
            : 'Video plays muted and looped.'}
        </p>
      </div>

      <div className="ads-media-slot">
        {hasMedia && ad.media.type === 'video'
          ? <video src={ad.media.url} muted playsInline loop autoPlay poster={ad.media.poster || undefined} />
          : null}
        {hasMedia && ad.media.type === 'image' ? <img src={ad.media.url} alt="" /> : null}
        {!hasMedia ? <Icon name="image" size={30} /> : null}
        {busy === 'upload' || busy === 'image' ? <Spinner /> : null}
      </div>

      <div className="ads-media-btns">
        <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={!!busy}>
          <Icon name="upload" size={16} />
          {ar ? 'رفع ملف' : 'Upload'}
        </button>
        <button type="button" className="btn" onClick={() => setLib(true)} disabled={!!busy}>
          <Icon name="folder" size={16} />
          {ar ? 'من المكتبة' : 'From library'}
        </button>
        {hasMedia ? (
          <button type="button" className="btn" onClick={() => media({ type: 'none', url: '', poster: '' })} disabled={!!busy}>
            <Icon name="delete" size={16} />
            {ar ? 'إزالة' : 'Remove'}
          </button>
        ) : null}
        <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={onFile} />
      </div>

      {ad.media.type === 'video' ? (
        <div className="field">
          <label htmlFor="ads-poster">{ar ? 'صورة الغلاف للفيديو (اختياري)' : 'Video poster (optional)'}</label>
          <input
            id="ads-poster"
            className="input"
            value={ad.media.poster}
            onChange={(e) => media({ poster: e.target.value })}
            placeholder="https://"
            dir="ltr"
          />
        </div>
      ) : null}

      {/* ---- AI ---- */}
      <div className="ads-ai">
        <h4>
          <Icon name="sparkles" size={16} />
          {' '}
          {ar ? 'صمّم بالذكاء' : 'Design with AI'}
        </h4>
        <p className="ads-hint">
          {ar
            ? 'الصورة تُبنى من صور منتجاتك الحقيقية وهوية المنشأة، وتُسجَّل في «سجل التوليد».'
            : 'The image is built from your real product photos and identity.'}
        </p>
        <div className="field">
          <label htmlFor="ads-prompt">{ar ? 'وصف المشهد أو موضوع الإعلان' : 'Scene or ad subject'}</label>
          <textarea
            id="ads-prompt"
            className="textarea"
            rows={2}
            value={stylePrompt}
            onChange={(e) => setStylePrompt(e.target.value)}
            placeholder={ar ? 'مثال: عرض نهاية الأسبوع، إضاءة دافئة وخلفية داكنة' : 'e.g. weekend offer, warm light, dark backdrop'}
          />
        </div>
        <div className="ads-media-btns">
          <button type="button" className="btn btn-primary" onClick={genImage} disabled={!!busy}>
            {busy === 'image' ? <Spinner /> : <Icon name="image" size={16} />}
            {ar ? 'أنشئ الصورة' : 'Generate image'}
          </button>
          <button type="button" className="btn" onClick={genCopy} disabled={!!busy}>
            {busy === 'text' ? <Spinner /> : <Icon name="text" size={16} />}
            {ar ? 'اكتب العنوان والزر' : 'Write the copy'}
          </button>
        </div>
        {err ? <div className="ads-ai-err">{err}</div> : null}
      </div>

      {/* ---- words ---- */}
      <div>
        <h4>{ar ? 'النص' : 'Text'}</h4>
      </div>
      <div className="field">
        <label htmlFor="ads-headline">{ar ? 'العنوان' : 'Headline'}</label>
        <input
          id="ads-headline"
          className="input"
          value={ad.headline}
          maxLength={120}
          onChange={(e) => top({ headline: e.target.value })}
          placeholder={ar ? 'جملة واحدة تلفت الانتباه' : 'One attention-grabbing line'}
        />
      </div>
      <div className="field">
        <label htmlFor="ads-body">{ar ? 'النص التوضيحي' : 'Body'}</label>
        <textarea
          id="ads-body"
          className="textarea"
          rows={3}
          maxLength={400}
          value={ad.body}
          onChange={(e) => top({ body: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="ads-cta">{ar ? 'نص زر الإجراء' : 'CTA label'}</label>
        <input
          id="ads-cta"
          className="input"
          value={ad.ctaLabel}
          maxLength={40}
          onChange={(e) => top({ ctaLabel: e.target.value })}
          placeholder={ar ? 'اتركه فارغاً لإخفاء الزر' : 'Leave empty to hide the button'}
        />
      </div>

      {/* ---- colours and form ---- */}
      <div>
        <h4>{ar ? 'الألوان والشكل' : 'Colours and form'}</h4>
      </div>
      <div className="ads-colors">
        <label className="ads-color">
          <span>{ar ? 'الخلفية' : 'Background'}</span>
          <input type="color" value={ad.design.bg} onChange={(e) => design({ bg: e.target.value })} />
        </label>
        <label className="ads-color">
          <span>{ar ? 'لون النص' : 'Text'}</span>
          <input type="color" value={ad.design.textColor} onChange={(e) => design({ textColor: e.target.value })} />
        </label>
        <label className="ads-color">
          <span>{ar ? 'لون الزر' : 'Accent'}</span>
          <input type="color" value={ad.design.accent} onChange={(e) => design({ accent: e.target.value })} />
        </label>
      </div>

      {textWeak && !hasMedia ? (
        <div className="ads-warn">
          <Icon name="warning" size={16} />
          <span>
            {ar
              ? `تباين النص مع الخلفية ${num(Math.round(textRatio * 10) / 10)}:1 فقط — النص سيكون صعب القراءة. اختر لوناً أفتح أو أغمق.`
              : `Text contrast is only ${Math.round(textRatio * 10) / 10}:1.`}
          </span>
        </div>
      ) : null}

      <div className="ads-grid2">
        <div className="ads-range">
          <span>
            <b>{ar ? 'استدارة الحواف' : 'Corner radius'}</b>
            <b>{num(ad.design.radius)}</b>
          </span>
          <input
            type="range"
            min="0"
            max="60"
            value={ad.design.radius}
            onChange={(e) => design({ radius: Number(e.target.value) })}
          />
        </div>
        <div className="ads-range">
          <span>
            <b>{ar ? 'تعتيم الصورة خلف النص' : 'Overlay'}</b>
            <b>{`${num(ad.design.overlayOpacity)}%`}</b>
          </span>
          <input
            type="range"
            min="0"
            max="95"
            value={ad.design.overlayOpacity}
            onChange={(e) => design({ overlayOpacity: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="ads-grid2">
        <div className="field">
          <label htmlFor="ads-pos">{ar ? 'موضع النص' : 'Text position'}</label>
          <select
            id="ads-pos"
            className="select"
            value={ad.design.textPos}
            onChange={(e) => design({ textPos: e.target.value })}
            disabled={ad.shape === 'circle'}
          >
            {TEXT_POSITIONS.map((p) => <option key={p.id} value={p.id}>{ar ? p.ar : p.en}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ads-font">{ar ? 'الخط' : 'Font'}</label>
          <select
            id="ads-font"
            className="select"
            value={ad.design.fontKey}
            onChange={(e) => design({ fontKey: e.target.value })}
          >
            {FONT_OPTIONS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
      </div>

      <MediaLibrary
        open={lib}
        onClose={() => setLib(false)}
        tenantId={tenantId}
        lang={lang}
        folder="ads"
        onPick={(url, m) => {
          const kind = m?.kind === 'video' ? 'video' : 'image'
          media({ type: kind, url })
          setLib(false)
        }}
      />
    </>
  )
}
