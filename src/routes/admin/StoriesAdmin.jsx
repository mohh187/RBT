import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { watchStories, addStory, deleteStory, updateStory, watchStoryReplies, deleteStoryReply } from '../../lib/db.js'
import Sheet from '../../components/Sheet.jsx'
import { timeAgo } from '../../lib/format.js'
import { uploadImage, uploadFile } from '../../lib/storage.js'
import ImageCropper from '../../components/ImageCropper.jsx'
import { generatePostImage, generateCaption } from '../../lib/postGen.js'

const MAX_VIDEO_MB = 25

// Manage menu stories: capture/upload photos & short videos, caption, delete.
// Visibility on the menu is toggled from Appearance → hidden elements.
export default function StoriesAdmin() {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const { tenantId, tenant } = useAuth()
  const toast = useToast()
  const [list, setList] = useState(null)
  const [title, setTitle] = useState('') // headline shown at the top of the story + on its circle
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(null) // { file, url, isVideo } — staged before publish
  const [filterCss, setFilterCss] = useState('')
  const [link, setLink] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [cropFile, setCropFile] = useState(null) // staged image being cropped to 9:16
  const [repliesFor, setRepliesFor] = useState(null) // story whose reply inbox is open
  const [replies, setReplies] = useState([])
  useEffect(() => {
    if (!repliesFor || !tenantId) return
    return watchStoryReplies(tenantId, repliesFor.id, setReplies)
  }, [repliesFor, tenantId])
  const [aud, setAud] = useState(null) // {file, url, start, dur} — story soundtrack
  // AI generation panel (this screen loads no items — refs are local uploads only, CORS-immune)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiDesc, setAiDesc] = useState('')
  const [aiRef, setAiRef] = useState(null) // File — optional reference (product photo / logo)
  const [aiBusy, setAiBusy] = useState('') // '' | 'image' | 'text'
  // free-drag text/emoji overlays: {id, text, x, y (%), color, size}
  const [overlays, setOverlays] = useState([])
  const [selId, setSelId] = useState(null)
  const prevRef = useRef(null)
  const dragging = useRef(null)

  const addOverlay = () => {
    const id = `t${Date.now()}`
    setOverlays((o) => [...o, { id, text: ar ? 'اكتب هنا' : 'Your text', x: 50, y: 42, color: '#ffffff', size: 24 }])
    setSelId(id)
  }
  const patchOverlay = (id, patch) => setOverlays((o) => o.map((v) => (v.id === id ? { ...v, ...patch } : v)))
  const onOvMove = (e) => {
    if (!dragging.current || !prevRef.current) return
    const r = prevRef.current.getBoundingClientRect()
    const x = Math.min(96, Math.max(4, ((e.clientX - r.left) / r.width) * 100))
    const y = Math.min(96, Math.max(4, ((e.clientY - r.top) / r.height) * 100))
    patchOverlay(dragging.current, { x: Math.round(x), y: Math.round(y) })
  }

  // Instagram-style filter presets — swipe/scroll through them over the preview
  const FILTERS = [
    ['', ar ? 'أصلي' : 'Original'],
    ['saturate(1.6) contrast(1.1)', ar ? 'حيوي' : 'Vivid'],
    ['sepia(.45) saturate(1.3)', ar ? 'دافئ' : 'Warm'],
    ['grayscale(1)', ar ? 'أبيض وأسود' : 'B&W'],
    ['contrast(1.25) brightness(.9)', ar ? 'سينمائي' : 'Cinema'],
    ['hue-rotate(-15deg) saturate(1.25) brightness(1.05)', ar ? 'غروب' : 'Sunset'],
    ['brightness(1.15) saturate(.85)', ar ? 'فاتح' : 'Fade'],
  ]

  useEffect(() => { if (!tenantId) return; return watchStories(tenantId, setList) }, [tenantId])

  const onPick = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || busy) return
    const isVideo = file.type.startsWith('video/')
    if (isVideo && file.size > MAX_VIDEO_MB * 1024 * 1024) { toast.error(ar ? `الفيديو أكبر من ${MAX_VIDEO_MB}MB` : `Video over ${MAX_VIDEO_MB}MB`); return }
    if (draft?.url) URL.revokeObjectURL(draft.url)
    setFilterCss(''); setOverlays([]); setSelId(null)
    setDraft({ file, url: URL.createObjectURL(file), isVideo })
  }

  const onAudioPick = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (aud?.url) URL.revokeObjectURL(aud.url)
    setAud({ file: f, url: URL.createObjectURL(f), start: 0, dur: 0 })
  }

  const onAiRef = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) setAiRef(f)
  }
  const aiImage = async () => {
    if (aiBusy || busy) return
    if (!aiDesc.trim() && !aiRef) { toast.error(ar ? 'اكتب وصفاً أو ارفع صورة مرجعية أولاً' : 'Describe the scene or upload a reference first'); return }
    setAiBusy('image')
    try {
      const blob = await generatePostImage({ refFiles: aiRef ? [aiRef] : [], stylePrompt: aiDesc.trim(), venueName: tenant?.name || '', tenant })
      const f = new File([blob], `story-ai-${Date.now()}.png`, { type: blob.type || 'image/png' })
      if (draft?.url) URL.revokeObjectURL(draft.url)
      setFilterCss(''); setOverlays([]); setSelId(null)
      // same staged path as a manual pick — publish() uploads it normally, nothing auto-publishes
      setDraft({ file: f, url: URL.createObjectURL(f), isVideo: false })
    } catch (e) { toast.error(String(e?.message || e)) } finally { setAiBusy('') }
  }
  const aiText = async () => {
    if (aiBusy || busy) return
    setAiBusy('text')
    try {
      const txt = await generateCaption({ itemName: aiDesc.trim() || title.trim(), venueName: tenant?.name || '' })
      setCaption(txt.replace(/\s*\n+\s*/g, ' '))
    } catch (e) { toast.error(String(e?.message || e)) } finally { setAiBusy('') }
  }

  const publish = async () => {
    if (!draft || busy) return
    setBusy(true)
    try {
      const url = draft.isVideo ? await uploadFile(tenantId, draft.file, 'stories') : await uploadImage(tenantId, draft.file, 'stories')
      const audioUrl = aud ? await uploadFile(tenantId, aud.file, 'stories') : ''
      await addStory(tenantId, { kind: draft.isVideo ? 'video' : 'image', url, title: title.trim(), caption: caption.trim(), filterCss, link: link.trim(), linkLabel: linkLabel.trim(), overlays, audioUrl, audioStart: aud ? Math.round(aud.start) : 0 })
      URL.revokeObjectURL(draft.url)
      if (aud?.url) URL.revokeObjectURL(aud.url)
      setDraft(null); setTitle(''); setCaption(''); setLink(''); setLinkLabel(''); setFilterCss(''); setOverlays([]); setSelId(null); setAud(null)
      toast.success(ar ? 'نُشر الاستوري (يظهر 24 ساعة)' : 'Story published (24h)')
    } catch (e) {
      const code = e?.code || ''
      toast.error(code.includes('permission') || code.includes('unauthorized')
        ? (ar ? 'مرفوض: انشر قواعد Firestore/Storage المحدثة أولاً (firebase deploy --only firestore:rules,storage)' : 'Denied: deploy the updated Firestore/Storage rules first')
        : t('error'))
    } finally { setBusy(false) }
  }

  if (list === null) return <Spinner />
  const now = Date.now()

  return (
    <div className="page stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="row-between">
        <h2 className="page-title">{ar ? 'الاستوري' : 'Stories'}</h2>
        <span className="badge">{list.length}</span>
      </div>

      <div className="card card-pad stack" style={{ gap: 10 }}>
        {draft && (
          <>
            {/* staged preview + swipeable filter presets + free-drag text overlays */}
            <div className={aiBusy === 'image' ? 'ai-scanning' : ''} style={{ borderRadius: 'var(--r-md)', overflow: 'hidden', maxHeight: 340, display: 'grid', placeItems: 'center', background: '#000' }}>
              <div ref={prevRef} className="story-ov-edit" style={{ position: 'relative', display: 'inline-block' }}
                onPointerMove={onOvMove} onPointerUp={() => { dragging.current = null }} onPointerCancel={() => { dragging.current = null }}>
                {draft.isVideo
                  ? <video src={draft.url} style={{ maxWidth: '100%', maxHeight: 340, display: 'block', filter: filterCss || undefined }} autoPlay muted loop playsInline />
                  : <img src={draft.url} alt="" style={{ maxWidth: '100%', maxHeight: 340, display: 'block', filter: filterCss || undefined }} />}
                {overlays.map((o) => (
                  <span key={o.id} className={selId === o.id ? 'sel' : ''} style={{ left: `${o.x}%`, top: `${o.y}%`, fontSize: o.size, color: o.color }}
                    onPointerDown={(e) => { e.preventDefault(); dragging.current = o.id; setSelId(o.id); e.currentTarget.setPointerCapture?.(e.pointerId) }}>
                    {o.text}
                  </span>
                ))}
              </div>
            </div>
            <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-outline" onClick={addOverlay}><Icon name="add" size={14} /> {ar ? 'نص / إيموجي' : 'Text / emoji'}</button>
              {!draft.isVideo && <button className="btn btn-sm btn-outline" onClick={() => setCropFile(draft.file)}><Icon name="image" size={14} /> {ar ? 'قص 9:16' : 'Crop 9:16'}</button>}
              <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
                <Icon name="sound" size={14} /> {aud ? (ar ? 'تغيير الصوت' : 'Change audio') : (ar ? 'موسيقى / صوت' : 'Music / audio')}
                <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={onAudioPick} />
              </label>
              {selId && overlays.find((o) => o.id === selId) && (() => { const o = overlays.find((x) => x.id === selId); return (
                <>
                  <input className="input input-sm grow" style={{ minWidth: 120 }} value={o.text} onChange={(e) => patchOverlay(selId, { text: e.target.value })} />
                  <input type="color" value={o.color} style={{ width: 34, height: 30, border: 'none', background: 'none', cursor: 'pointer' }} onChange={(e) => patchOverlay(selId, { color: e.target.value })} />
                  <input type="range" min="14" max="56" step="2" value={o.size} style={{ width: 90 }} onChange={(e) => patchOverlay(selId, { size: Number(e.target.value) })} />
                  <button className="icon-btn" style={{ width: 30, height: 30, color: 'var(--danger)' }} onClick={() => { setOverlays((v) => v.filter((x) => x.id !== selId)); setSelId(null) }}><Icon name="delete" size={14} /></button>
                </>
              ) })()}
            </div>
            <div className="row" style={{ gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
              {FILTERS.map(([css, name]) => (
                <button key={name} type="button" className="stack" style={{ flex: 'none', alignItems: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setFilterCss(css)}>
                  <span style={{ width: 52, height: 52, borderRadius: 10, overflow: 'hidden', border: filterCss === css ? '2px solid var(--brand)' : '2px solid var(--border)', display: 'block' }}>
                    {!draft.isVideo && <img src={draft.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: css || undefined }} />}
                  </span>
                  <span className={`xs ${filterCss === css ? 'bold' : 'faint'}`}>{name}</span>
                </button>
              ))}
            </div>
            {aud && (
              <div className="stack" style={{ gap: 6, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 8 }}>
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <Icon name="sound" size={14} style={{ color: 'var(--brand)' }} />
                  <span className="xs grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{aud.file.name}</span>
                  <button className="icon-btn" style={{ width: 28, height: 28, color: 'var(--danger)' }} onClick={() => { URL.revokeObjectURL(aud.url); setAud(null) }}><Icon name="delete" size={13} /></button>
                </div>
                <audio src={aud.url} controls style={{ width: '100%', height: 32 }} onLoadedMetadata={(e) => setAud((a) => (a ? { ...a, dur: e.target.duration || 0 } : a))} />
                <label className="xs faint">{ar ? `بداية التشغيل: ${Math.round(aud.start)} ثانية` : `Start at: ${Math.round(aud.start)}s`}</label>
                <input type="range" min="0" max={Math.max(0, Math.floor((aud.dur || 30) - 3))} step="1" value={aud.start}
                  onChange={(e) => setAud((a) => (a ? { ...a, start: Number(e.target.value) } : a))} style={{ width: '100%' }} />
              </div>
            )}
            <div className="row" style={{ gap: 6 }}>
              <input className="input input-sm grow" dir="ltr" placeholder={ar ? 'رابط (اختياري) https://…' : 'Link (optional)'} value={link} onChange={(e) => setLink(e.target.value)} />
              <input className="input input-sm" style={{ width: 130 }} placeholder={ar ? 'نص الزر' : 'Button label'} value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} />
            </div>
          </>
        )}
        <input className="input" placeholder={ar ? 'عنوان الاستوري (يظهر أعلى الاستوري وعلى الدائرة)' : 'Story title (top of story + circle)'} value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="input" placeholder={ar ? 'وصف قصير (اختياري)' : 'Caption (optional)'} value={caption} onChange={(e) => setCaption(e.target.value)} />
        <button className="btn btn-sm btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => setAiOpen((o) => !o)}>
          <Icon name="sparkles" size={14} /> {ar ? 'توليد بالذكاء' : 'Generate with AI'}
        </button>
        {aiOpen && (
          <div className="stack" style={{ gap: 8, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 10 }}>
            <textarea className="textarea" rows={2} placeholder={ar ? 'وصف المشهد… (مثال: كوب لاتيه على طاولة رخام بإضاءة دافئة)' : 'Describe the scene…'} value={aiDesc} onChange={(e) => setAiDesc(e.target.value)} />
            <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
                <Icon name="image" size={14} /> {aiRef ? (ar ? 'تغيير المرجع' : 'Change reference') : (ar ? 'صورة مرجعية (اختياري)' : 'Reference photo (optional)')}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onAiRef} disabled={!!aiBusy} />
              </label>
              {aiRef && <span className="xs faint grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{aiRef.name}</span>}
              {aiRef && <button className="icon-btn" style={{ width: 28, height: 28, color: 'var(--danger)' }} disabled={!!aiBusy} onClick={() => setAiRef(null)}><Icon name="delete" size={13} /></button>}
            </div>
            {aiBusy === 'image' && !draft && (
              <div className="center ai-scanning" style={{ height: 110, borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px dashed var(--border-strong)' }}>
                <Icon name="sparkles" size={22} className="muted" />
              </div>
            )}
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm btn-primary grow" disabled={!!aiBusy || busy} onClick={aiImage}>{aiBusy === 'image' ? (ar ? 'جارٍ التوليد…' : 'Generating…') : (ar ? 'توليد الصورة' : 'Generate image')}</button>
              <button className="btn btn-sm btn-outline grow" disabled={!!aiBusy || busy} onClick={aiText}>{aiBusy === 'text' ? (ar ? 'جارٍ الكتابة…' : 'Writing…') : (ar ? 'اكتب نصاً' : 'Write caption')}</button>
            </div>
            <p className="xs faint" style={{ margin: 0 }}>{ar ? 'الصورة الناتجة تدخل نفس مسار المعاينة والنشر اليدوي — لا يُنشر شيء تلقائياً.' : 'The result feeds the normal preview — nothing publishes automatically.'}</p>
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <label className={`btn ${draft ? 'btn-outline' : 'btn-primary'} grow`} style={{ cursor: 'pointer' }}>
            <Icon name="camera" size={17} /> {draft ? (ar ? 'تغيير الوسائط' : 'Change media') : (ar ? 'صوّر / ارفع' : 'Capture / upload')}
            <input type="file" accept="image/*,video/*" capture="environment" style={{ display: 'none' }} onChange={onPick} disabled={busy} />
          </label>
          {draft && <button className="btn btn-primary grow" disabled={busy || !!aiBusy} onClick={publish}>{busy ? t('saving') : (ar ? 'نشر الاستوري' : 'Publish')}</button>}
        </div>
        <p className="xs faint" style={{ margin: 0 }}>{ar ? 'يظهر على المنيو لمدة 24 ساعة. الإخفاء الكلي من: الإعدادات ← تصميم المظهر ← إخفاء العناصر.' : 'Visible on the menu for 24h. Hide the strip via Appearance → hidden elements.'}</p>
      </div>

      <Sheet open={!!repliesFor} onClose={() => setRepliesFor(null)} title={ar ? 'ردود الاستوري' : 'Story replies'}>
        {replies.length === 0 ? <p className="muted small">{ar ? 'لا ردود بعد' : 'No replies yet'}</p> : (
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {replies.map((r) => (
              <div key={r.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{r.text}</div>
                  <div className="xs faint">{r.at ? timeAgo(r.at, lang) : ''}</div>
                </div>
                <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => deleteStoryReply(tenantId, repliesFor.id, r.id)}><Icon name="delete" size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </Sheet>

      {cropFile && (
        <ImageCropper file={cropFile} aspect={9 / 16} output={{ width: 1080, height: 1920 }}
          title={ar ? 'قص الاستوري (9:16)' : 'Crop story (9:16)'}
          hint={ar ? 'المقاس المثالي للعرض العمودي' : 'Ideal portrait framing'}
          onClose={() => setCropFile(null)}
          onCropped={(blob) => {
            const f = new File([blob], 'story.jpg', { type: blob.type || 'image/jpeg' })
            if (draft?.url) URL.revokeObjectURL(draft.url)
            setDraft({ file: f, url: URL.createObjectURL(f), isVideo: false })
            setCropFile(null)
          }} />
      )}

      {list.length === 0 ? (
        <Empty icon="camera" title={ar ? 'لا استوري بعد' : 'No stories yet'} hint={ar ? 'صوّر صنف اليوم وانشره لزبائنك' : 'Capture today’s special'} />
      ) : (
        <div className="item-grid">
          {list.map((s) => {
            const expired = !s.highlight && (s.expiresAt || 0) <= now
            return (
              <div key={s.id} className={`item-tile card ${expired ? 'unavailable' : ''}`} style={{ cursor: 'default' }}>
                {s.kind === 'video'
                  ? <video className="pos-tile-media" src={s.url} muted />
                  : <img className="pos-tile-media" src={s.url} alt="" loading="lazy" />}
                <div className="stack" style={{ gap: 6, padding: '8px 10px 10px' }}>
                  <span className="small bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.caption || (s.kind === 'video' ? (ar ? 'فيديو' : 'Video') : (ar ? 'صورة' : 'Photo'))}</span>
                  <span className="xs faint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    <Icon name="eye" size={11} /> {s.views || 0}
                    <Icon name="heart" size={11} /> {s.likes || 0}
                    {s.highlight ? <><Icon name="star" size={11} style={{ color: 'var(--gold)' }} /> {ar ? 'دائم' : 'Pinned'}</> : expired ? <span>· {ar ? 'منتهي' : 'Expired'}</span> : null}
                  </span>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="icon-btn" style={{ width: 32, height: 32 }} title={s.highlight ? (ar ? 'إلغاء التثبيت الدائم' : 'Unpin') : (ar ? 'تثبيت دائم (لا ينتهي)' : 'Pin permanently')}
                      onClick={() => updateStory(tenantId, s.id, { highlight: s.highlight ? '' : (s.title || s.caption || (ar ? 'دائم' : 'Pinned')) })}>
                      <Icon name="star" size={15} fill={s.highlight ? 'currentColor' : 'none'} style={{ color: s.highlight ? 'var(--gold)' : undefined }} />
                    </button>
                    <button className="icon-btn" style={{ width: 32, height: 32 }} title={ar ? 'ردود الزبائن' : 'Replies'} onClick={() => setRepliesFor(s)}><Icon name="message" size={15} /></button>
                    <button className="icon-btn" style={{ width: 32, height: 32, color: 'var(--danger)', marginInlineStart: 'auto' }} onClick={() => deleteStory(tenantId, s.id)}><Icon name="delete" size={15} /></button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
