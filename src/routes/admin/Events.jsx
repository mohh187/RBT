import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n, pickLang } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import Sheet from '../../components/Sheet.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { watchEvents, saveEvent, deleteEvent, watchTickets } from '../../lib/db.js'
import { uploadImage } from '../../lib/storage.js'
import { generatePostImage } from '../../lib/postGen.js'
import { money } from '../../lib/format.js'
import { menuUrl } from '../../lib/qr.js'

function toLocalInput(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
  if (!d) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function fmtDate(ts, lang) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
  if (!d) return ''
  return d.toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

const blank = () => ({ titleAr: '', titleEn: '', descAr: '', imageUrl: '', startsAt: '', location: '', capacity: '', ticketTypes: [{ nameAr: '', price: '' }], status: 'draft' })

export default function Events() {
  const { t, lang } = useI18n()
  const { tenantId, tenant } = useAuth()
  const toast = useToast()
  const currency = tenant?.currency || 'SAR'
  const [events, setEvents] = useState(null)
  const [tickets, setTickets] = useState([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [attendeesFor, setAttendeesFor] = useState(null)
  // AI poster panel — builds a cinematic prompt from the event's own fields
  const [aiOpen, setAiOpen] = useState(false)
  const [aiDesc, setAiDesc] = useState('')
  const [aiBusy, setAiBusy] = useState(false)

  useEffect(() => {
    if (!tenantId) return
    const u1 = watchEvents(tenantId, setEvents)
    const u2 = watchTickets(tenantId, setTickets)
    return () => { u1(); u2() }
  }, [tenantId])

  const soldByEvent = useMemo(() => {
    const m = {}
    // Count realized sales only — a 'pending' ticket is an abandoned/unpaid hold.
    tickets.filter((x) => x.status === 'valid' || x.status === 'used').forEach((x) => { m[x.eventId] = (m[x.eventId] || 0) + 1 })
    return m
  }, [tickets])
  const checkedInByEvent = useMemo(() => {
    const m = {}
    tickets.filter((x) => x.status === 'used').forEach((x) => { m[x.eventId] = (m[x.eventId] || 0) + 1 })
    return m
  }, [tickets])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const openNew = () => { setForm(blank()); setAiDesc(''); setAiOpen(false); setOpen(true) }
  const openEdit = (e) => { setForm({ ...blank(), ...e, startsAt: toLocalInput(e.startsAt), ticketTypes: e.ticketTypes?.length ? e.ticketTypes : [{ nameAr: '', price: '' }] }); setAiDesc(''); setAiOpen(false); setOpen(true) }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try { set('imageUrl', await uploadImage(tenantId, file, 'events')) } catch (_) { toast.error(t('error')) } finally { setUploading(false) }
  }

  const genPoster = async () => {
    if (aiBusy || uploading) return
    const name = (form.titleAr || form.titleEn || '').trim()
    if (!name && !aiDesc.trim()) { toast.error(lang === 'ar' ? 'اكتب اسم الفعالية أو وصفاً أولاً' : 'Enter the event title or a description first'); return }
    setAiBusy(true)
    try {
      const when = form.startsAt ? new Date(form.startsAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : ''
      const stylePrompt = [
        'cinematic event poster mood, dramatic lighting',
        name ? `poster scene for the event "${name}"` : '',
        when ? `taking place on ${when}` : '',
        form.location ? `at ${form.location}` : '',
        (form.descAr || '').trim(),
        aiDesc.trim(),
      ].filter(Boolean).join(', ')
      const blob = await generatePostImage({ stylePrompt, venueName: tenant?.name || '', tenant })
      const f = new File([blob], `event-ai-${Date.now()}.png`, { type: blob.type || 'image/png' })
      // same field + folder as the manual upload path — saving remains a manual step
      set('imageUrl', await uploadImage(tenantId, f, 'events'))
    } catch (e) { toast.error(String(e?.message || e)) } finally { setAiBusy(false) }
  }

  const setType = (i, k, v) => set('ticketTypes', form.ticketTypes.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)))
  const addType = () => set('ticketTypes', [...form.ticketTypes, { nameAr: '', price: '' }])
  const delType = (i) => set('ticketTypes', form.ticketTypes.filter((_, idx) => idx !== i))

  const save = async () => {
    if (!form.titleAr?.trim() && !form.titleEn?.trim()) { toast.error(t('error')); return }
    await saveEvent(tenantId, form.id, {
      titleAr: (form.titleAr || '').trim(), titleEn: (form.titleEn || '').trim(),
      descAr: form.descAr || '', imageUrl: form.imageUrl || '',
      startsAt: form.startsAt ? new Date(form.startsAt) : null,
      location: form.location || '', capacity: Number(form.capacity) || 0,
      ticketTypes: (form.ticketTypes || []).filter((x) => x.nameAr || x.nameEn).map((x, i) => ({ key: `t${i}`, nameAr: x.nameAr || '', nameEn: x.nameEn || '', price: Number(x.price) || 0 })),
      status: form.status || 'draft',
    })
    setOpen(false)
    toast.success(t('saved'))
  }
  const remove = async () => {
    if (!window.confirm(t('areYouSure'))) return
    await deleteEvent(tenantId, form.id)
    setOpen(false)
    toast.success(t('deleted'))
  }

  if (events === null) return <Spinner />

  return (
    <div className="page stack">
      <div className="row-between">
        <h2 className="page-title">{t('events')}</h2>
        <button className="btn btn-primary btn-sm" onClick={openNew}><Icon name="add" size={16} /> {t('addEvent')}</button>
      </div>
      {tenant?.slug && (
        <a href={`${menuUrl(tenant.slug).replace('/m/', '/e/')}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ color: 'var(--brand)', width: 'fit-content' }}>
          <Icon name="eye" size={16} /> {lang === 'ar' ? 'صفحة الفعاليات العامة ↗' : 'Public events page ↗'}
        </a>
      )}

      {events.length === 0 ? (
        <Empty icon="events" title={t('noEvents')} action={<button className="btn btn-primary" onClick={openNew}>+ {t('addEvent')}</button>} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {events.map((e) => (
            <div key={e.id} className="stack" style={{ gap: 4 }}>
              <button className="item-card" onClick={() => openEdit(e)}>
                {e.imageUrl ? <img className="thumb" src={e.imageUrl} alt="" /> : <div className="thumb center"><Icon name="events" size={26} /></div>}
                <div className="body">
                  <div className="name">{pickLang(e, 'title', lang)}</div>
                  <div className="xs faint">{fmtDate(e.startsAt, lang)}</div>
                  <div className="meta">
                    <span className={`badge ${e.status === 'published' ? 'badge-success' : ''}`}>{t(e.status === 'published' ? 'published' : 'draft')}</span>
                    <span className="badge"><Icon name="ticket" size={13} /> {soldByEvent[e.id] || 0}{e.capacity ? `/${e.capacity}` : ''}</span>
                    {(checkedInByEvent[e.id] || 0) > 0 && <span className="badge badge-success"><Icon name="ok" size={12} /> {lang === 'ar' ? 'دخلوا' : 'in'} {checkedInByEvent[e.id]}</span>}
                  </div>
                </div>
              </button>
              {(soldByEvent[e.id] || 0) > 0 && (
                <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', color: 'var(--brand)' }} onClick={() => setAttendeesFor(e.id)}>
                  <Icon name="ticket" size={14} /> {lang === 'ar' ? `عرض التذاكر والحضور (${soldByEvent[e.id]})` : `View tickets & attendees (${soldByEvent[e.id]})`}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* attendees / tickets list for one event */}
      <Sheet open={!!attendeesFor} onClose={() => setAttendeesFor(null)} title={lang === 'ar' ? 'التذاكر والحضور' : 'Tickets & attendees'}>
        {(() => {
          const list = tickets.filter((x) => x.eventId === attendeesFor && x.status !== 'cancelled').sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
          if (list.length === 0) return <Empty icon="ticket" title={lang === 'ar' ? 'لا تذاكر بعد' : 'No tickets yet'} />
          const inCount = list.filter((x) => x.status === 'used').length
          return (
            <div className="stack" style={{ gap: 'var(--sp-2)' }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="badge"><Icon name="ticket" size={13} /> {list.length} {lang === 'ar' ? 'تذكرة' : 'tickets'}</span>
                <span className="badge badge-success"><Icon name="ok" size={12} /> {inCount} {lang === 'ar' ? 'دخلوا' : 'checked in'}</span>
              </div>
              {list.map((tk) => {
                const used = tk.status === 'used'
                const cancelled = tk.status === 'cancelled'
                return (
                  <div key={tk.id} className="list-row">
                    <span className="center" style={{ width: 34, height: 34, borderRadius: '50%', flex: 'none', background: used ? 'var(--success-soft)' : 'var(--surface-2)', color: used ? 'var(--success)' : 'var(--text-muted)' }}><Icon name={used ? 'ok' : 'ticket'} size={16} /></span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="small bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tk.name || (lang === 'ar' ? 'ضيف' : 'Guest')}{tk.typeName ? ` · ${tk.typeName}` : ''}</div>
                      <div className="xs faint" dir="ltr" style={{ textAlign: lang === 'ar' ? 'right' : 'left' }}>{tk.phone || ''} · {tk.code}</div>
                    </div>
                    <span className={`badge ${used ? 'badge-success' : cancelled ? 'badge-danger' : tk.status === 'pending' ? 'badge-warning' : ''}`}>{used ? (lang === 'ar' ? 'دخل' : 'In') : cancelled ? (lang === 'ar' ? 'ملغى' : 'Cancelled') : tk.status === 'pending' ? (lang === 'ar' ? 'بانتظار الدفع' : 'Unpaid') : (lang === 'ar' ? 'صالحة' : 'Valid')}</span>
                  </div>
                )
              })}
            </div>
          )
        })()}
      </Sheet>

      <Sheet open={open} onClose={() => setOpen(false)} title={form?.id ? t('edit') : t('addEvent')}
        footer={
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            {form?.id && <button className="btn btn-danger" onClick={remove}><Icon name="delete" size={18} /></button>}
            <button className="btn btn-primary grow" disabled={aiBusy} onClick={save}>{t('save')}</button>
          </div>
        }>
        {form && (
          <div className="stack">
            <label style={{ cursor: 'pointer' }}>
              <div className={`center ${aiBusy ? 'ai-scanning' : ''}`} style={{ width: '100%', height: 120, borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--surface-2)', border: '1px dashed var(--border-strong)' }}>
                {uploading ? <div className="spinner" /> : form.imageUrl ? <img src={form.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name={aiBusy ? 'sparkles' : 'camera'} size={26} className="muted" />}
              </div>
              <input type="file" accept="image/*" hidden onChange={onFile} disabled={aiBusy} />
            </label>
            <button className="btn btn-sm btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => setAiOpen((o) => !o)}>
              <Icon name="sparkles" size={14} /> {lang === 'ar' ? 'توليد بوستر الفعالية' : 'Generate event poster'}
            </button>
            {aiOpen && (
              <div className="stack" style={{ gap: 8, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 10 }}>
                <textarea className="textarea" rows={2} placeholder={lang === 'ar' ? 'وصف إضافي للبوستر (اختياري)… يُبنى تلقائياً من اسم الفعالية وتاريخها ووصفها' : 'Extra poster description (optional)…'} value={aiDesc} onChange={(e) => setAiDesc(e.target.value)} />
                <button className="btn btn-sm btn-primary" disabled={aiBusy || uploading} onClick={genPoster}>{aiBusy ? (lang === 'ar' ? 'جارٍ توليد البوستر…' : 'Generating poster…') : (lang === 'ar' ? 'توليد بوستر الفعالية' : 'Generate poster')}</button>
                <p className="xs faint" style={{ margin: 0 }}>{lang === 'ar' ? 'البوستر يعبّئ صورة الفعالية فقط — الحفظ يبقى بيدك.' : 'The poster only fills the event image — saving stays manual.'}</p>
              </div>
            )}
            <div className="field"><label>{t('eventTitle')}</label><input className="input" value={form.titleAr} onChange={(e) => set('titleAr', e.target.value)} /></div>
            <div className="field"><label>{t('description')}</label><textarea className="textarea" value={form.descAr} onChange={(e) => set('descAr', e.target.value)} /></div>
            <div className="field"><label>{t('eventDate')}</label><input className="input" type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></div>
            <div className="row" style={{ gap: 'var(--sp-3)' }}>
              <div className="field grow"><label>{lang === 'ar' ? 'المكان' : 'Location'}</label><input className="input" value={form.location} onChange={(e) => set('location', e.target.value)} /></div>
              <div className="field" style={{ maxWidth: 110 }}><label>{t('capacity')}</label><input className="input num" type="number" value={form.capacity} onChange={(e) => set('capacity', e.target.value)} /></div>
            </div>
            <div className="field">
              <div className="row-between"><label>{t('ticketTypes')}</label><button className="btn btn-sm btn-outline" onClick={addType}>+ {t('addTicketType')}</button></div>
              {form.ticketTypes.map((x, i) => (
                <div key={i} className="row" style={{ gap: 6, marginTop: 6 }}>
                  <input className="input" placeholder={lang === 'ar' ? 'مثال: عام / VIP' : 'e.g. General / VIP'} value={x.nameAr} onChange={(e) => setType(i, 'nameAr', e.target.value)} />
                  <input className="input num" style={{ maxWidth: 90 }} type="number" placeholder={t('price')} value={x.price} onChange={(e) => setType(i, 'price', e.target.value)} />
                  <button className="icon-btn" onClick={() => delType(i)}><Icon name="close" size={16} /></button>
                </div>
              ))}
            </div>
            <div className="field">
              <label>{lang === 'ar' ? 'الحالة' : 'Status'}</label>
              <div className="segmented">
                <button className={form.status === 'draft' ? 'active' : ''} onClick={() => set('status', 'draft')}>{t('draft')}</button>
                <button className={form.status === 'published' ? 'active' : ''} onClick={() => set('status', 'published')}>{t('publish')}</button>
              </div>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}
