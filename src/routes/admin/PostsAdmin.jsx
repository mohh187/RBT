import { useEffect, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { watchPosts, addPost, updatePost, deletePost } from '../../lib/db.js'
import { uploadImage, uploadFile } from '../../lib/storage.js'
import { POST_TYPES } from '../menu/VenueProfile.jsx'
import { timeAgo } from '../../lib/format.js'
import DinerNoticeComposer from '../../components/DinerNoticeComposer.jsx'
import { generatePostImage, cleanCaption } from '../../lib/postGen.js'
import { aiQuick } from '../../lib/aiBridge.js'

// Venue profile manager: news / events / notable visits / videos — the living
// blog shown publicly at /m/{slug}/about (hide the menu button via Appearance).
export default function PostsAdmin() {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const { tenantId, tenant } = useAuth()
  const toast = useToast()
  const [list, setList] = useState(null)
  const [type, setType] = useState('news')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [media, setMedia] = useState([]) // [{kind,url}] already uploaded
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)
  // AI generation panel (this screen loads no items — refs are local uploads only, CORS-immune)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiDesc, setAiDesc] = useState('')
  const [aiRef, setAiRef] = useState(null) // File — optional reference (product photo / logo)
  const [aiBusy, setAiBusy] = useState('') // '' | 'image' | 'text'

  useEffect(() => { if (!tenantId) return; return watchPosts(tenantId, setList) }, [tenantId])

  const onMedia = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || busy) return
    setBusy(true)
    try {
      const isV = f.type.startsWith('video/')
      const url = isV ? await uploadFile(tenantId, f, 'posts') : await uploadImage(tenantId, f, 'posts')
      setMedia((m) => [...m, { kind: isV ? 'video' : 'image', url }])
    } catch (_) { toast.error(t('error')) } finally { setBusy(false) }
  }

  const onAiRef = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) setAiRef(f)
  }
  const aiCover = async () => {
    if (aiBusy || busy) return
    if (!aiDesc.trim() && !aiRef) { toast.error(ar ? 'اكتب وصفاً أو ارفع صورة مرجعية أولاً' : 'Describe the scene or upload a reference first'); return }
    setAiBusy('image')
    try {
      const blob = await generatePostImage({ refFiles: aiRef ? [aiRef] : [], stylePrompt: aiDesc.trim(), venueName: tenant?.name || '', tenant })
      const f = new File([blob], `post-ai-${Date.now()}.png`, { type: blob.type || 'image/png' })
      // same upload path + media state as the manual "add media" flow — publish stays manual
      const url = await uploadImage(tenantId, f, 'posts')
      setMedia((m) => [...m, { kind: 'image', url }])
    } catch (e) { toast.error(String(e?.message || e)) } finally { setAiBusy('') }
  }
  const aiBody = async () => {
    if (aiBusy || busy) return
    if (!aiDesc.trim() && !title.trim()) { toast.error(ar ? 'اكتب وصفاً قصيراً للخبر أولاً' : 'Describe the news first'); return }
    setAiBusy('text')
    try {
      const prompt = [
        'أنت كاتب محتوى محترف لمنشآت الضيافة.',
        `اكتب خبراً قصيراً (3 إلى 5 أسطر) لصفحة "${tenant?.name || 'منشأتنا'}" العامة عن: ${aiDesc.trim() || title.trim()}.`,
        'أسلوب عربي راقٍ وواضح يناسب صفحة أخبار المنشأة، دون مبالغة.',
        'ممنوع منعاً باتاً: الرموز التعبيرية (الإيموجي) بكل أنواعها، والأرقام العربية المشرقية — استخدم الأرقام اللاتينية فقط.',
        'أجب بنص الخبر فقط دون أي شرح أو مقدمات.',
      ].join('\n')
      const out = cleanCaption(await aiQuick(prompt))
      if (!out) throw new Error(ar ? 'لم يصل رد من الذكاء — أعد المحاولة.' : 'No AI reply — try again.')
      setBody(out)
    } catch (e) { toast.error(String(e?.message || e)) } finally { setAiBusy('') }
  }

  const publish = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      await addPost(tenantId, { type, title: title.trim(), body: body.trim(), media, pinned, published: true })
      setTitle(''); setBody(''); setMedia([]); setPinned(false)
      toast.success(ar ? 'نُشر في بروفايل المنشأة' : 'Published to the venue profile')
    } catch (e) {
      const code = e?.code || ''
      toast.error(code.includes('permission') ? (ar ? 'انشر قواعد Firestore أولاً' : 'Deploy Firestore rules first') : t('error'))
    } finally { setBusy(false) }
  }

  if (list === null) return <Spinner />

  return (
    <div className="page stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="row-between">
        <h2 className="page-title">{ar ? 'البروفايل والأخبار' : 'Profile & news'}</h2>
        {tenant?.slug && <a className="btn btn-sm btn-outline" href={`/m/${tenant.slug}/about`} target="_blank" rel="noreferrer"><Icon name="eye" size={14} /> {ar ? 'عرض الصفحة' : 'View page'}</a>}
      </div>

      <DinerNoticeComposer tenantId={tenantId} />

      {/* composer */}
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {POST_TYPES.map(([id, a, e]) => (
            <button key={id} className={`chip ${type === id ? 'active' : ''}`} onClick={() => setType(id)}>{ar ? a : e}</button>
          ))}
        </div>
        <input className="input" placeholder={ar ? 'العنوان' : 'Title'} value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="textarea" rows={4} placeholder={ar ? 'اكتب التفاصيل… (فعالية نظمتموها، ضيف زاركم، خبر جديد)' : 'Write the details…'} value={body} onChange={(e) => setBody(e.target.value)} />
        <button className="btn btn-sm btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => setAiOpen((o) => !o)}>
          <Icon name="sparkles" size={14} /> {ar ? 'توليد بالذكاء' : 'Generate with AI'}
        </button>
        {aiOpen && (
          <div className="stack" style={{ gap: 8, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 10 }}>
            <input className="input input-sm" placeholder={ar ? 'وصف قصير… (مثال: افتتاح ركن الحلويات الجديد)' : 'Short description…'} value={aiDesc} onChange={(e) => setAiDesc(e.target.value)} />
            <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
                <Icon name="image" size={14} /> {aiRef ? (ar ? 'تغيير المرجع' : 'Change reference') : (ar ? 'صورة مرجعية (اختياري)' : 'Reference photo (optional)')}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onAiRef} disabled={!!aiBusy} />
              </label>
              {aiRef && <span className="xs faint grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{aiRef.name}</span>}
              {aiRef && <button className="icon-btn" style={{ width: 28, height: 28, color: 'var(--danger)' }} disabled={!!aiBusy} onClick={() => setAiRef(null)}><Icon name="close" size={13} /></button>}
            </div>
            {aiBusy === 'image' && (
              <div className="center ai-scanning" style={{ height: 100, borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px dashed var(--border-strong)' }}>
                <Icon name="sparkles" size={22} className="muted" />
              </div>
            )}
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-primary grow" disabled={!!aiBusy || busy} onClick={aiCover}>{aiBusy === 'image' ? (ar ? 'جارٍ التوليد…' : 'Generating…') : (ar ? 'توليد صورة الغلاف' : 'Generate cover image')}</button>
              <button className="btn btn-sm btn-outline grow" disabled={!!aiBusy || busy} onClick={aiBody}>{aiBusy === 'text' ? (ar ? 'جارٍ الكتابة…' : 'Writing…') : (ar ? 'اكتب الخبر بالذكاء' : 'Write the news with AI')}</button>
            </div>
            <p className="xs faint" style={{ margin: 0 }}>{ar ? 'النتيجة تعبّئ الحقول فقط — النشر يبقى بيدك.' : 'Results only fill the form — publishing stays manual.'}</p>
          </div>
        )}
        {media.length > 0 && (
          <div className="row" style={{ gap: 6, overflowX: 'auto' }}>
            {media.map((m, i) => (
              <div key={i} style={{ position: 'relative', flex: 'none' }}>
                {m.kind === 'video'
                  ? <video src={m.url} muted style={{ height: 74, borderRadius: 8, background: '#000' }} />
                  : <img src={m.url} alt="" style={{ height: 74, borderRadius: 8 }} />}
                <button className="icon-btn" style={{ position: 'absolute', top: 2, insetInlineEnd: 2, width: 24, height: 24, background: 'rgba(0,0,0,.55)', color: '#fff' }}
                  onClick={() => setMedia((x) => x.filter((_, j) => j !== i))}><Icon name="close" size={12} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
            <Icon name="image" size={14} /> {busy ? t('saving') : (ar ? 'إضافة صورة/فيديو' : 'Add media')}
            <input type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={onMedia} disabled={busy} />
          </label>
          <label className="row" style={{ gap: 6, cursor: 'pointer', alignItems: 'center' }}>
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} style={{ width: 18, height: 18 }} />
            <span className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="pin" size={13} /> {ar ? 'تثبيت أعلى الصفحة' : 'Pin to top'}</span>
          </label>
          <button className="btn btn-primary" style={{ marginInlineStart: 'auto' }} disabled={!title.trim() || busy || !!aiBusy} onClick={publish}>{busy ? t('saving') : (ar ? 'نشر' : 'Publish')}</button>
        </div>
      </div>

      {/* posts list */}
      {list.length === 0 ? (
        <Empty icon="events" title={ar ? 'لا منشورات بعد' : 'No posts yet'} hint={ar ? 'شارك خبراً أو فعالية أو زيارة مميزة' : 'Share news, an event, or a notable visit'} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {list.map((p) => (
            <div key={p.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              {(p.media?.[0]?.url) && (p.media[0].kind === 'video'
                ? <video src={p.media[0].url} muted style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 8, flex: 'none' }} />
                : <img src={p.media[0].url} alt="" style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 8, flex: 'none' }} />)}
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>{p.pinned && <Icon name="pin" size={12} style={{ color: 'var(--gold)', flex: 'none' }} />}{p.title}</div>
                <div className="xs faint" style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  <span>{(POST_TYPES.find(([id]) => id === p.type)?.[ar ? 1 : 2]) || p.type} · {p.createdAt ? timeAgo(p.createdAt, lang) : ''}</span>
                  <Icon name="heart" size={11} /> {p.likes || 0}
                  <Icon name="eye" size={11} /> {p.views || 0}
                  {p.published === false && <span>· {ar ? 'مخفي' : 'Hidden'}</span>}
                </div>
              </div>
              <button className="icon-btn" title={p.published === false ? (ar ? 'إظهار' : 'Show') : (ar ? 'إخفاء' : 'Hide')}
                onClick={() => updatePost(tenantId, p.id, { published: p.published === false })}><Icon name="eye" size={16} style={{ opacity: p.published === false ? 0.35 : 1 }} /></button>
              <button className="icon-btn" title={ar ? 'تثبيت' : 'Pin'} onClick={() => updatePost(tenantId, p.id, { pinned: !p.pinned })}><Icon name="pin" size={15} style={{ color: p.pinned ? 'var(--gold)' : undefined }} /></button>
              <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => deletePost(tenantId, p.id)}><Icon name="delete" size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
