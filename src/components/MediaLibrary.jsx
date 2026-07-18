import { useEffect, useMemo, useState } from 'react'
import { collection, doc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { useToast } from './Toast.jsx'
import { watchMedia, deleteMedia } from '../lib/db.js'
import { db, storage } from '../lib/firebase.js'
import { randomToken } from '../lib/format.js'
import { useAuth } from '../lib/auth.jsx'

// Central media-library picker. Every upload across the system is auto-registered
// (storage.js → logMedia), so this shows all reusable assets — images, videos,
// audio, files. Open it anywhere an upload happens to pick an existing asset
// instead of re-uploading. `kind` locks the filter (e.g. 'video' for a bg video).
//
// PICKER CONTRACT (do not break — ScreensAdmin + Settings depend on it):
//   • onPick(url, item) fires on card click AND after a fresh single upload;
//     item always carries at least { url, kind, name }.
//   • `kind` prop locks the type filter (tabs hidden, other kinds not shown).
//   • `folder` prop is the STORAGE subpath (tenants/{tid}/{folder}/…, default
//     'library'); it is unrelated to the VIRTUAL doc-level `folder` field below.
//
// V2: virtual folders (doc field `folder`, '' = الجذر), any-type uploads,
// multi-file upload with per-file progress, copy-URL + manager-only move.
// Uploads here write the media doc directly (instead of storage.js logMedia)
// so `folder` and a correct non-media `kind: 'file'` can be set at create time
// — logMedia has no folder param and mis-kinds unknown types as images.
const KINDS = [
  ['all', { ar: 'الكل', en: 'All' }],
  ['image', { ar: 'صور', en: 'Images' }],
  ['video', { ar: 'فيديو', en: 'Videos' }],
  ['audio', { ar: 'صوت', en: 'Audio' }],
  ['file', { ar: 'ملفات', en: 'Files' }],
]

// Client mirror of storage.rules → tenants/{tid}/library/ limits (fail fast
// with a clear message instead of uploading for minutes then being rejected).
const LIB_LIMITS_MB = { image: 10, video: 150, audio: 40, file: 25 }

// Extension fallbacks for files whose browser `type` is empty (mirrors
// storage.js): keeps kind + content-type correct so the right rule limit applies.
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba', 'wma']
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'ogv', 'm4v', '3gp']
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico']
const AUDIO_CT = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac', weba: 'audio/webm', wma: 'audio/x-ms-wma' }
const VIDEO_CT = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo', ogv: 'video/ogg', m4v: 'video/mp4', '3gp': 'video/3gpp' }

const extOf = (name) => ((name || '').split('.').pop() || '').toLowerCase()
const kindOf = (f) => {
  const t = f.type || ''
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  if (t.startsWith('image/')) return 'image'
  const ext = extOf(f.name)
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  if (IMAGE_EXT.includes(ext)) return 'image'
  return 'file'
}
const bestContentType = (f) => {
  const t = f.type || ''
  if (/^(audio|video|image)\//.test(t)) return t
  const ext = extOf(f.name)
  return VIDEO_CT[ext] || AUDIO_CT[ext] || t || 'application/octet-stream'
}
const fmtMB = (size) => (size > 0 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : '')
const extBadge = (m) => {
  const e = extOf(m.name || m.url).replace(/[?#].*$/, '')
  return (e && e.length <= 5 ? e : 'file').toUpperCase()
}

export default function MediaLibrary({ open, onClose, onPick, tenantId, kind, folder = 'library', lang = 'ar', accept }) {
  const ar = lang === 'ar'
  const toast = useToast()
  const { isManager } = useAuth()
  const [items, setItems] = useState(null)
  const [tab, setTab] = useState(kind || 'all')
  const [folderSel, setFolderSel] = useState('all') // 'all' | '' (root) | folder name
  const [localFolders, setLocalFolders] = useState([]) // virtual folders created this session (empty until first upload)
  const [newFolder, setNewFolder] = useState(null) // null = closed, string = inline input value
  const [uploads, setUploads] = useState([]) // per-file rows: { key, name, size, pct, state: 'up'|'err', err }

  useEffect(() => { if (!open || !tenantId) return; setItems(null); return watchMedia(tenantId, setItems) }, [open, tenantId])
  useEffect(() => { if (open) { setTab(kind || 'all'); setFolderSel('all'); setNewFolder(null); setUploads([]) } }, [open, kind])

  const filter = kind || tab
  const folders = useMemo(() => {
    const set = new Set(localFolders)
    for (const m of items || []) if (m.folder) set.add(m.folder)
    return [...set].sort((a, b) => a.localeCompare(b, ar ? 'ar' : 'en'))
  }, [items, localFolders, ar])
  const shown = useMemo(() => (items || []).filter((m) =>
    (filter === 'all' ? true : (m.kind || 'file') === filter)
    && (folderSel === 'all' ? true : (m.folder || '') === folderSel)
  ), [items, filter, folderSel])

  const busy = uploads.some((u) => u.state === 'up')
  const patchRow = (key, patch) => setUploads((us) => us.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  // Resumable upload to tenants/{tid}/{folder}/… + direct media-doc registration
  // (superset of logMedia's fields + `folder`). Fires the same 'ml:upload'
  // events storage.js fires so the global progress HUD keeps working.
  const uploadOne = async (f, targetFolder, key) => {
    const k = kindOf(f)
    const limit = LIB_LIMITS_MB[k]
    if (f.size > limit * 1024 * 1024) {
      throw new Error(ar
        ? `الملف كبير جداً (${fmtMB(f.size)}) — الحد الأقصى ${limit}MB`
        : `File too large (${fmtMB(f.size)}) — max ${limit}MB`)
    }
    const meta = { name: f.name || '', size: f.size || 0 }
    const fire = (detail) => { try { window.dispatchEvent(new CustomEvent('ml:upload', { detail })) } catch (_) { /* ignore */ } }
    const ext = extOf(f.name) || 'bin'
    const r = storageRef(storage, `tenants/${tenantId}/${folder}/${Date.now()}-${randomToken(6)}.${ext}`)
    fire({ ...meta, progress: 0, state: 'start' })
    try {
      await new Promise((resolve, reject) => {
        const task = uploadBytesResumable(r, f, { contentType: bestContentType(f) })
        task.on('state_changed', (s) => {
          const p = s.totalBytes ? Math.round((s.bytesTransferred / s.totalBytes) * 100) : 0
          patchRow(key, { pct: p })
          fire({ ...meta, progress: p, state: 'progress' })
        }, reject, resolve)
      })
      fire({ ...meta, progress: 100, state: 'done' })
    } catch (e) {
      fire({ ...meta, progress: 0, state: 'error' })
      throw e
    }
    const url = await getDownloadURL(r)
    const data = { url, name: f.name || '', size: f.size || 0, contentType: bestContentType(f) || '', kind: k, folder: targetFolder }
    // Doc registration is best-effort (like storage.js): a rules hiccup must
    // not lose an already-uploaded file — the picker still gets its URL.
    try {
      const dref = await addDoc(collection(db, 'tenants', tenantId, 'media'), { ...data, createdAt: serverTimestamp() })
      return { id: dref.id, ...data }
    } catch (_) { return data }
  }

  const uploadNew = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length || busy) return
    const targetFolder = folderSel === 'all' ? '' : folderSel
    const stamp = Date.now()
    const rows = files.map((f, i) => ({ key: `${stamp}-${i}`, name: f.name, size: f.size, pct: 0, state: 'up', err: '' }))
    setUploads(rows)
    // Per-file isolation: one failure never kills the batch.
    const results = await Promise.all(files.map((f, i) =>
      uploadOne(f, targetFolder, rows[i].key)
        .then((m) => { patchRow(rows[i].key, { pct: 100, state: 'done' }); return m })
        .catch((err) => { patchRow(rows[i].key, { state: 'err', err: err?.message || (ar ? 'فشل الرفع' : 'Upload failed') }); return null })
    ))
    setUploads((us) => us.filter((r) => r.state === 'err')) // keep failures visible, drop done rows
    const ok = results.filter(Boolean)
    if (files.length === 1 && ok.length === 1) onPick?.(ok[0].url, ok[0]) // freshly uploaded → also select it
  }

  const remove = async (m, ev) => {
    ev.stopPropagation()
    if (!window.confirm(ar ? 'إزالة من المكتبة؟ (لا يُحذف من الأماكن المستخدَم فيها)' : 'Remove from library? (stays where already used)')) return
    try { await deleteMedia(tenantId, m.id) } catch (_) { toast.error(ar ? 'تعذّر الحذف' : 'Delete failed') }
  }
  const copyUrl = async (m, ev) => {
    ev.stopPropagation()
    try { await navigator.clipboard.writeText(m.url); toast.success(ar ? 'تم نسخ الرابط' : 'Link copied') } catch (_) { toast.error(ar ? 'تعذّر النسخ' : 'Copy failed') }
  }
  // Firestore media UPDATE rule is manager-only — gate here too (disable + hint).
  const moveTo = async (m, target) => {
    if (!isManager || target === (m.folder || '')) return
    try { await updateDoc(doc(db, 'tenants', tenantId, 'media', m.id), { folder: target }) } catch (_) { toast.error(ar ? 'تعذّر النقل' : 'Move failed') }
  }
  const addFolder = () => {
    const name = (newFolder || '').trim()
    if (!name) { setNewFolder(null); return }
    if (!folders.includes(name)) setLocalFolders((fs) => [...fs, name])
    setFolderSel(name)
    setNewFolder(null)
  }

  const moveHint = ar ? 'النقل بين المجلدات للمدير فقط' : 'Only managers can move files'
  const acc = accept || (kind === 'video' ? 'video/*' : kind === 'audio' ? 'audio/*' : kind === 'image' ? 'image/*' : undefined)

  const moveSelect = (m) => (
    <select className="ml-move" value={m.folder || ''} disabled={!isManager || !m.id}
      title={isManager ? (ar ? 'نقل إلى…' : 'Move to…') : moveHint}
      onClick={(e) => e.stopPropagation()} onChange={(e) => moveTo(m, e.target.value)}>
      <option value="">{ar ? 'الجذر' : 'Root'}</option>
      {folders.map((f) => <option key={f} value={f}>{f}</option>)}
    </select>
  )
  const cardActions = (m) => (
    <div className="ml-actions" onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn ml-act" onClick={(e) => copyUrl(m, e)} title={ar ? 'نسخ الرابط' : 'Copy link'}><Icon name="copy" size={13} /></button>
      {moveSelect(m)}
    </div>
  )
  const removeBtn = (m) => (
    <button className="icon-btn ml-remove" onClick={(e) => remove(m, e)} title={ar ? 'إزالة' : 'Remove'}><Icon name="close" size={13} /></button>
  )

  return (
    <Sheet open={open} onClose={onClose} title={ar ? 'مكتبة الوسائط' : 'Media library'}>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
            <Icon name="upload" size={14} /> {busy ? (ar ? 'يرفع…' : 'Uploading…') : (ar ? 'رفع جديد' : 'Upload new')}
            <input type="file" multiple accept={acc} style={{ display: 'none' }} disabled={busy} onChange={uploadNew} />
          </label>
          {!kind && (
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {KINDS.map(([id, l]) => (
                <button key={id} className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab(id)}>{ar ? l.ar : l.en}</button>
              ))}
            </div>
          )}
        </div>

        {/* virtual folders (doc field `folder`, '' = root) — combinable with the type filter */}
        <div className="ml-folders">
          <button className={`chip ${folderSel === 'all' ? 'active' : ''}`} onClick={() => setFolderSel('all')}>{ar ? 'الكل' : 'All'}</button>
          <button className={`chip ${folderSel === '' ? 'active' : ''}`} onClick={() => setFolderSel('')}><Icon name="folder" size={13} /> {ar ? 'الجذر' : 'Root'}</button>
          {folders.map((f) => (
            <button key={f} className={`chip ${folderSel === f ? 'active' : ''}`} onClick={() => setFolderSel(f)}><Icon name="folder" size={13} /> {f}</button>
          ))}
          {newFolder === null ? (
            <button className="chip" onClick={() => setNewFolder('')}><Icon name="add" size={13} /> {ar ? 'مجلد جديد' : 'New folder'}</button>
          ) : (
            <span className="ml-newfolder">
              <input className="input input-sm" autoFocus value={newFolder} placeholder={ar ? 'اسم المجلد' : 'Folder name'}
                onChange={(e) => setNewFolder(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addFolder(); if (e.key === 'Escape') setNewFolder(null) }} />
              <button className="icon-btn" onClick={addFolder} title={ar ? 'إنشاء' : 'Create'}><Icon name="check" size={15} /></button>
              <button className="icon-btn" onClick={() => setNewFolder(null)} title={ar ? 'إلغاء' : 'Cancel'}><Icon name="close" size={15} /></button>
            </span>
          )}
        </div>

        {uploads.length > 0 && (
          <div className="stack" style={{ gap: 4 }}>
            {uploads.map((u) => (
              <div key={u.key} className={`ml-up-row ${u.state === 'err' ? 'is-err' : ''}`}>
                <span className="ml-up-name xs">{u.name}</span>
                <span className="xs faint">{fmtMB(u.size)}</span>
                {u.state === 'err' ? (
                  <>
                    <span className="xs" style={{ color: 'var(--danger)' }}>{u.err}</span>
                    <button className="icon-btn ml-act" onClick={() => setUploads((us) => us.filter((r) => r.key !== u.key))} title={ar ? 'إخفاء' : 'Dismiss'}><Icon name="close" size={12} /></button>
                  </>
                ) : (
                  <>
                    <span className="ml-up-bar"><span style={{ width: `${u.pct}%` }} /></span>
                    <span className="xs faint" style={{ minWidth: 34, textAlign: 'end' }}>{u.pct}%</span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {items === null ? (
          <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner" /></div>
        ) : shown.length === 0 ? (
          <p className="muted small" style={{ textAlign: 'center', padding: 20, lineHeight: 1.6 }}>
            {ar ? 'المكتبة فارغة — أي ملف ترفعه في النظام يُحفظ هنا تلقائياً لإعادة استخدامه.' : 'Library empty — every upload is saved here automatically to reuse.'}
          </p>
        ) : (
          <div className="ml-grid">
            {shown.map((m) => (m.kind === 'audio' ? (
              <div key={m.id} className="card ml-card ml-audio-row" role="button" tabIndex={0} onClick={() => onPick?.(m.url, m)} title={m.name}>
                <Icon name="sound" size={18} className="faint" />
                <div className="ml-audio-meta">
                  <div className="xs ml-name">{m.name || (ar ? 'صوت' : 'Audio')}</div>
                  {fmtMB(m.size) && <div className="xs faint">{fmtMB(m.size)}</div>}
                </div>
                <audio src={m.url} controls preload="none" onClick={(e) => e.stopPropagation()} />
                {cardActions(m)}
                {removeBtn(m)}
              </div>
            ) : (
              <div key={m.id} className="card ml-card" role="button" tabIndex={0} onClick={() => onPick?.(m.url, m)} title={m.name}>
                <div className="ml-thumb">
                  {m.kind === 'image' ? <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                    : m.kind === 'video' ? <video src={m.url} preload="metadata" muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : (
                        <div className="stack" style={{ alignItems: 'center', gap: 4 }}>
                          <Icon name="file" size={22} className="faint" />
                          <span className="ml-ext">{extBadge(m)}</span>
                        </div>
                      )}
                </div>
                <div className="xs ml-name" style={{ padding: '5px 7px 0' }}>{m.name || m.kind}</div>
                <div className="row" style={{ alignItems: 'center', gap: 6, padding: '0 7px' }}>
                  {fmtMB(m.size) && <span className="xs faint">{fmtMB(m.size)}</span>}
                </div>
                {cardActions(m)}
                {removeBtn(m)}
              </div>
            )))}
          </div>
        )}
      </div>
    </Sheet>
  )
}
