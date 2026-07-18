// Shared venue ⇄ platform chat thread (WhatsApp-style). Used by BOTH
// src/routes/admin/Support.jsx (side='venue') and src/routes/platform/Chat.jsx
// (side='platform'). Thread doc: platformChats/{tid} + messages subcollection.
//
// Message shape is PRESERVED exactly (the platform AI + Cloud Function relay
// also write/read it): { from, uid, name, text, at, fileUrl?, fileName?,
// fileType?, audioDuration? }. New fields are ADDITIVE only:
//   messages: { attachmentUrl, attachmentType: 'image'|'video'|'audio'|'file',
//               attachmentName, attachmentSize }
//   thread:   { venueLastReadAt, platformLastReadAt }  (read receipts)
import { Fragment, useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { useToast } from './Toast.jsx'
import { db } from '../lib/firebase.js'
import {
  doc, setDoc, addDoc, collection, deleteDoc, serverTimestamp,
} from 'firebase/firestore'
import { watchChatMessages, watchChatThread } from '../lib/platform.js'
import { uploadFile } from '../lib/storage.js'

const PAGE = 200 // messages per query window; «تحميل الأقدم» adds another page

const toDate = (ts) => (ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null)
const toMs = (ts) => (ts?.toMillis ? ts.toMillis() : ts ? +new Date(ts) : 0)

// Attachment kind for the message doc (mirrors storage.js sniffing: mime
// first, extension fallback — some files arrive with an empty file.type).
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba']
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'ogv', 'm4v', '3gp']
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'heic']
function attachmentTypeOf(file) {
  const t = file.type || ''
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  return 'file'
}

const fmtSize = (n) => {
  if (!n) return ''
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
const fmtDuration = (secs) => {
  const m = Math.floor((secs || 0) / 60).toString().padStart(2, '0')
  const s = ((secs || 0) % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function ChatThread({
  tid,               // thread id == tenantId
  side,              // 'venue' | 'platform'
  ar = true,
  uid,
  senderName = '',   // name written on outgoing messages
  tenantName = '',   // merged into the thread doc (existing behavior)
  commands = [],     // [{ icon, label, action: () => string|void }] — string result is sent as text
  placeholder,
  emptyHint,
}) {
  const toast = useToast()
  const otherReadField = side === 'venue' ? 'platformLastReadAt' : 'venueLastReadAt'

  const [messages, setMessages] = useState([])
  const [thread, setThread] = useState(null)
  const [limitN, setLimitN] = useState(PAGE)
  const [text, setText] = useState('')
  const [showCmds, setShowCmds] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [newPill, setNewPill] = useState(false)

  // voice notes
  const [recording, setRecording] = useState(false)
  const [recTime, setRecTime] = useState(0)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const recStartRef = useRef(0)
  const canRecord = typeof window !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder === 'function'

  // scrolling
  const scrollerRef = useRef(null)
  const taRef = useRef(null)
  const didInitRef = useRef(false)
  const nearBottomRef = useRef(true)
  const pendingOlderRef = useRef(0) // distance-from-bottom to restore after «تحميل الأقدم»

  // ---------- subscriptions ----------
  useEffect(() => {
    if (!tid) return
    return watchChatMessages(tid, setMessages, limitN)
  }, [tid, limitN])
  useEffect(() => {
    if (!tid) return
    return watchChatThread(tid, setThread)
  }, [tid])

  // Read receipt + unread counter: stamp MY side on open and whenever new
  // messages land while the thread is on screen (additive thread fields).
  useEffect(() => {
    if (!tid || !messages.length) return
    const patch = side === 'platform'
      ? { unreadByPlatform: 0, platformLastReadAt: serverTimestamp() }
      : { unreadByVenue: 0, venueLastReadAt: serverTimestamp() }
    setDoc(doc(db, 'platformChats', tid), patch, { merge: true }).catch(() => {})
  }, [tid, side, messages.length])

  // reset per-thread UI state if tid changes without a remount
  useEffect(() => {
    didInitRef.current = false
    nearBottomRef.current = true
    setNewPill(false)
    setLimitN(PAGE)
    setText('')
  }, [tid])

  // ---------- scroll behavior ----------
  const jumpToBottom = () => {
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
    nearBottomRef.current = true
    setNewPill(false)
  }
  const onScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90
    if (nearBottomRef.current) setNewPill(false)
  }
  useEffect(() => {
    const el = scrollerRef.current
    if (!el || !messages.length) return
    if (pendingOlderRef.current) { // keep the viewport anchored after prepending history
      el.scrollTop = el.scrollHeight - pendingOlderRef.current
      pendingOlderRef.current = 0
      return
    }
    if (!didInitRef.current) { didInitRef.current = true; el.scrollTop = el.scrollHeight; return }
    const last = messages[messages.length - 1]
    if (nearBottomRef.current || (last && last.from === side)) jumpToBottom()
    else if (last && last.from !== side) setNewPill(true)
  }, [messages])

  const loadOlder = () => {
    const el = scrollerRef.current
    if (el) pendingOlderRef.current = el.scrollHeight - el.scrollTop
    setLimitN((n) => n + PAGE)
  }

  // ---------- send (existing shape preserved; attachment fields additive) ----------
  const deliver = async ({ body = '', attachment = null }) => {
    const t = String(body || '').trim()
    if ((!t && !attachment) || !tid) return
    await setDoc(doc(db, 'platformChats', tid), {
      tenantId: tid,
      ...(tenantName ? { tenantName } : {}),
    }, { merge: true })
    await addDoc(collection(db, 'platformChats', tid, 'messages'), {
      from: side, uid: uid || null, name: senderName || '',
      text: t.slice(0, 2000), at: serverTimestamp(),
      ...(attachment ? {
        // legacy fields — kept for the platform AI + any existing reader
        fileUrl: attachment.url,
        fileName: attachment.name || '',
        fileType: attachment.type === 'video' ? 'file' : attachment.type,
        audioDuration: attachment.duration || null,
        // additive fields (2026-07-18)
        attachmentUrl: attachment.url,
        attachmentType: attachment.type,
        attachmentName: attachment.name || '',
        attachmentSize: attachment.size || 0,
      } : {}),
    })
  }

  const submit = async (e) => {
    e?.preventDefault()
    const body = text.trim()
    if (!body) return
    setText('')
    try { await deliver({ body }) } catch (_) {
      toast.error(ar ? 'تعذّر إرسال الرسالة' : 'Failed to send')
      setText(body)
    }
  }

  const runCommand = async (c) => {
    setShowCmds(false)
    try {
      const r = await c.action()
      if (typeof r === 'string' && r.trim()) await deliver({ body: r })
    } catch (_) {
      toast.error(ar ? 'تعذّر إرسال الرسالة' : 'Failed to send')
    }
  }

  // ---------- attachments ----------
  const sendAttachment = async (file, type, duration) => {
    // support-path rules cap 25MB; storage.js caps unknown/'file' kinds at 10MB
    const capMB = type === 'image' || type === 'file' ? 10 : 25
    if (file.size > capMB * 1024 * 1024) {
      toast.error(ar ? `الملف كبير جداً — الحد الأقصى ${capMB}MB` : `File too large — max ${capMB}MB`)
      return
    }
    setUploading(true)
    setUploadPct(0)
    try {
      const url = await uploadFile(tid, file, 'support', setUploadPct)
      await deliver({ attachment: { url, type, name: file.name || '', size: file.size || 0, duration: duration || null } })
    } catch (err) {
      toast.error(err?.message && /MB/.test(err.message) ? err.message : (ar ? 'فشل رفع الملف' : 'Upload failed'))
    } finally {
      setUploading(false)
      setUploadPct(0)
    }
  }

  const onAttach = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file || !tid) return
    await sendAttachment(file, attachmentTypeOf(file))
  }

  // ---------- voice notes ----------
  const startRecording = async () => {
    if (!canRecord) {
      toast.error(ar ? 'التسجيل الصوتي غير مدعوم على هذا المتصفح — أرفق ملفاً صوتياً بدلاً منه' : 'Voice recording is not supported on this browser')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find((t) => window.MediaRecorder.isTypeSupported?.(t)) || ''
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      mediaRecorderRef.current = rec
      audioChunksRef.current = []
      rec.ondataavailable = (ev) => { if (ev.data.size > 0) audioChunksRef.current.push(ev.data) }
      rec.onstop = async () => {
        const type = mime || 'audio/webm'
        const blob = new Blob(audioChunksRef.current, { type })
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        // duration from wall-clock (state is stale inside this closure)
        const secs = Math.max(1, Math.round((Date.now() - recStartRef.current) / 1000))
        if (blob.size > 1000) {
          const ext = type.includes('mp4') ? 'm4a' : 'webm'
          const f = new File([blob], `voice-note-${Date.now()}.${ext}`, { type })
          await sendAttachment(f, 'audio', secs)
        }
      }
      rec.start()
      recStartRef.current = Date.now()
      setRecording(true)
      setRecTime(0)
      timerRef.current = setInterval(() => setRecTime((t) => t + 1), 1000)
    } catch (_) {
      toast.error(ar ? 'يرجى مراجعة صلاحيات الميكروفون بالمتصفح' : 'Microphone access failed')
    }
  }
  const stopRecording = (cancel = false) => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    const rec = mediaRecorderRef.current
    if (rec && rec.state !== 'inactive') {
      if (cancel) rec.onstop = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null }
      rec.stop()
    }
    setRecording(false)
    setRecTime(0)
  }
  // release mic + timer if unmounted mid-recording
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
    const rec = mediaRecorderRef.current
    if (rec && rec.state !== 'inactive') { rec.onstop = () => {}; try { rec.stop() } catch (_) { /* ignore */ } }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null }
  }, [])

  // ---------- unsend ----------
  const unsend = async (msgId) => {
    if (!window.confirm(ar ? 'هل أنت متأكد من التراجع وحذف هذه الرسالة للجميع؟' : 'Unsend this message for everyone?')) return
    try {
      await deleteDoc(doc(db, 'platformChats', tid, 'messages', msgId))
      toast.success(ar ? 'تم التراجع عن الرسالة' : 'Message unsent')
    } catch (_) {
      toast.error(ar ? 'فشل التراجع عن الرسالة' : 'Failed to unsend')
    }
  }

  // ---------- formatting (Latin digits ONLY — ar-SA-u-nu-latn) ----------
  const locale = ar ? 'ar-SA-u-nu-latn' : 'en-GB'
  const fmtTime = (ts) => {
    const d = toDate(ts)
    return d ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : ''
  }
  const dayLabel = (d) => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const that = new Date(d); that.setHours(0, 0, 0, 0)
    const diff = Math.round((today - that) / 86400000)
    if (diff === 0) return ar ? 'اليوم' : 'Today'
    if (diff === 1) return ar ? 'أمس' : 'Yesterday'
    return d.toLocaleDateString(locale, {
      weekday: 'short', day: 'numeric', month: 'short',
      ...(that.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
    })
  }

  // read receipt under my LAST message
  let lastMineIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].from === side) { lastMineIdx = i; break } }
  const otherReadMs = toMs(thread?.[otherReadField])

  const autosize = () => {
    const t = taRef.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = Math.min(t.scrollHeight, 96) + 'px' // ~4 rows max
  }
  useEffect(autosize, [text])

  const hasMore = messages.length >= limitN

  const renderAttachment = (m) => {
    const url = m.attachmentUrl || m.fileUrl
    if (!url) return null
    const type = m.attachmentType || m.fileType || 'file'
    const name = m.attachmentName || m.fileName || ''
    const size = m.attachmentSize || 0
    if (type === 'image') {
      return <img className="ct-img" src={url} alt={name} loading="lazy" onClick={() => window.open(url, '_blank', 'noopener')} />
    }
    if (type === 'video') {
      return <video className="ct-video" src={url} controls preload="metadata" />
    }
    if (type === 'audio') {
      return (
        <div className="ct-audio">
          <audio controls src={url} preload="metadata" />
          {m.audioDuration ? (
            <span className="xs num" style={{ opacity: 0.6 }}>
              <Icon name="mic" size={10} style={{ verticalAlign: 'middle' }} /> {fmtDuration(m.audioDuration)}
            </span>
          ) : null}
        </div>
      )
    }
    return (
      <a className="ct-file" href={url} target="_blank" rel="noreferrer" download={name || true}>
        <Icon name="file" size={17} style={{ flex: 'none' }} />
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="ct-file-name">{name || (ar ? 'ملف مرفق' : 'Attached file')}</span>
          {size ? <span className="ct-file-size num">{fmtSize(size)}</span> : null}
        </span>
        <Icon name="download" size={14} style={{ flex: 'none', opacity: 0.7 }} />
      </a>
    )
  }

  return (
    <div className="ct-wrap">
      <div className="ct-scrollwrap">
        <div className="ct-scroll" ref={scrollerRef} onScroll={onScroll}>
          {hasMore && (
            <button type="button" className="btn btn-xs btn-outline ct-older" onClick={loadOlder}>
              {ar ? 'تحميل الأقدم' : 'Load older'}
            </button>
          )}
          {messages.length === 0 ? (
            <p className="muted small" style={{ textAlign: 'center', marginTop: 28 }}>
              {emptyHint || (ar ? 'اكتب رسالتك — يصلنا إشعار فوري وسنرد عليك هنا' : 'Write a message — we get notified instantly')}
            </p>
          ) : (
            messages.map((m, i) => {
              const mine = m.from === side
              const d = toDate(m.at)
              const prev = messages[i - 1]
              const pd = prev ? toDate(prev.at) : null
              const newDay = !!d && (!pd || d.toDateString() !== pd.toDateString())
              const showName = !!m.name && (!prev || prev.from !== m.from || prev.name !== m.name || newDay)
              let receipt = null
              if (i === lastMineIdx) {
                const msgMs = toMs(m.at)
                const seen = !!(otherReadMs && msgMs && otherReadMs >= msgMs)
                receipt = (
                  <div className="ct-receipt">
                    {seen ? <Icon name="check" size={11} style={{ verticalAlign: 'middle', color: 'var(--brand)' }} /> : null}
                    {seen ? (ar ? 'تم الاطلاع' : 'Seen') : (ar ? 'أُرسلت' : 'Sent')}
                  </div>
                )
              }
              return (
                <Fragment key={m.id}>
                  {newDay && <div className="ct-day"><span>{dayLabel(d)}</span></div>}
                  <div className={`ct-row${mine ? ' mine' : ''}`}>
                    {mine && (
                      <button
                        type="button" className="ct-unsend"
                        title={ar ? 'تراجع عن الإرسال' : 'Unsend'}
                        onClick={() => unsend(m.id)}
                      >
                        <Icon name="undo" size={13} />
                      </button>
                    )}
                    <div className="ct-bubble">
                      {showName && <div className="ct-sender">{m.name}</div>}
                      {renderAttachment(m)}
                      {m.text ? <div className="ct-text">{m.text}</div> : null}
                      <div className="ct-time num">{fmtTime(m.at)}</div>
                    </div>
                  </div>
                  {receipt}
                </Fragment>
              )
            })
          )}
        </div>
        {newPill && (
          <button type="button" className="ct-pill" onClick={jumpToBottom}>
            <Icon name="arrowUp" size={13} style={{ transform: 'rotate(180deg)' }} />
            {ar ? 'رسائل جديدة' : 'New messages'}
          </button>
        )}
      </div>

      {uploading && (
        <div className="ct-busy">
          <span className="spinner" style={{ width: 14, height: 14 }} />
          <span className="small faint num">{ar ? 'جاري رفع الملف…' : 'Uploading…'} {uploadPct ? `${uploadPct}%` : ''}</span>
        </div>
      )}

      {recording ? (
        <div className="ct-rec">
          <span className="ct-rec-dot pulse-red" />
          <span className="small bold grow num" style={{ color: 'var(--danger, #e11d48)' }}>
            <Icon name="mic" size={12} style={{ verticalAlign: 'middle' }} /> {ar ? 'جاري التسجيل…' : 'Recording…'} {fmtDuration(recTime)}
          </span>
          <button type="button" className="btn btn-sm btn-outline text-danger" onClick={() => stopRecording(true)}>
            <Icon name="delete" size={14} /> {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => stopRecording(false)}>
            <Icon name="check" size={14} /> {ar ? 'إرسال' : 'Send'}
          </button>
        </div>
      ) : (
        <form className="ct-composer" onSubmit={submit}>
          <label className="ct-iconbtn" aria-disabled={uploading} title={ar ? 'إرفاق ملف' : 'Attach a file'}>
            <Icon name="clip" size={17} />
            <input type="file" hidden onChange={onAttach} disabled={uploading} />
          </label>

          {commands.length > 0 && (
            <div className="ct-cmds">
              <button type="button" className="ct-iconbtn" title={ar ? 'إجراءات سريعة' : 'Quick actions'} onClick={() => setShowCmds((v) => !v)}>
                <strong style={{ fontSize: 16 }}>/</strong>
              </button>
              {showCmds && (
                <div className="ct-cmds-pop">
                  {commands.map((c, idx) => (
                    <button key={idx} type="button" className="btn btn-xs btn-outline" style={{ justifyContent: 'flex-start' }} onClick={() => runCommand(c)}>
                      <Icon name={c.icon} size={12} style={{ verticalAlign: 'middle' }} /> {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <textarea
            ref={taRef}
            className="input ct-input"
            rows={1}
            placeholder={placeholder || (ar ? 'اكتب رسالتك…' : 'Type a message…')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
            }}
          />

          {text.trim() ? (
            <button type="submit" className="ct-send" title={ar ? 'إرسال' : 'Send'}>
              <Icon name="arrowUp" size={17} />
            </button>
          ) : canRecord ? (
            <button type="button" className="ct-iconbtn" title={ar ? 'تسجيل صوتي' : 'Record a voice note'} onClick={startRecording} disabled={uploading}>
              <Icon name="mic" size={16} />
            </button>
          ) : (
            <button type="submit" className="ct-send" disabled title={ar ? 'اكتب رسالة' : 'Type a message'} style={{ opacity: 0.45 }}>
              <Icon name="arrowUp" size={17} />
            </button>
          )}
        </form>
      )}
    </div>
  )
}
