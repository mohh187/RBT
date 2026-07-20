// «الطلب الجماعي» — one live basket shared by every phone at the table.
//
// Each guest joins with a name, adds items from the menu, and instantly sees
// what everyone else added plus the automatic per-person split. Deleting is
// restricted to your own lines (client check here; the real boundary is rules).
import { useEffect, useMemo, useRef, useState } from 'react'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { Spinner, Stepper } from './ui.jsx'
import { Price } from './Riyal.jsx'
import { useToast } from './Toast.jsx'
import {
  deviceGuestId,
  savedGuestName,
  rememberGuestName,
  sessionIdFor,
  joinSession,
  watchSession,
  removeLine,
  setLineQty,
  markOrdered,
  sessionTotal,
  sessionCount,
  splitByGuest,
  equalShare,
} from '../lib/tableSession.js'

const initials = (name) => String(name || '?').trim().slice(0, 2) || '?'

export default function SharedCart({ open, onClose, tenantId, table, currency = 'SAR', lang = 'ar', onPlaceOrder }) {
  const ar = lang === 'ar'
  const toast = useToast()
  const myId = deviceGuestId()

  const [name, setName] = useState(() => savedGuestName())
  const [joined, setJoined] = useState(false)
  const [joining, setJoining] = useState(false)
  const [session, setSession] = useState(undefined) // undefined = loading, null = none
  const [err, setErr] = useState(null)
  const [busyLine, setBusyLine] = useState('')
  const [placing, setPlacing] = useState(false)
  const autoTried = useRef(false)

  const sessionId = table?.id ? sessionIdFor(table.id) : ''

  // Live document. The error branch clears the spinner instead of hanging —
  // a permission-denied or offline snapshot must SAY so, not spin forever.
  useEffect(() => {
    if (!open || !tenantId || !sessionId || !joined) return undefined
    setSession(undefined)
    setErr(null)
    const off = watchSession(tenantId, sessionId, (s, e) => {
      if (e) { setErr(e); setSession(null); return }
      setErr(null)
      setSession(s)
    })
    return off
  }, [open, tenantId, sessionId, joined])

  const doJoin = async (who) => {
    const clean = String(who || '').trim()
    if (!clean) { toast.error(ar ? 'اكتب اسمك أولاً' : 'Enter your name first'); return }
    if (!tenantId || !table?.id) { toast.error(ar ? 'امسح رمز الطاولة للانضمام' : 'Scan the table QR to join'); return }
    setJoining(true)
    try {
      rememberGuestName(clean)
      await joinSession(tenantId, table, clean)
      setJoined(true)
    } catch (e) {
      setErr(e)
      toast.error(ar ? 'تعذّر الانضمام إلى الطاولة' : 'Could not join the table')
    } finally {
      setJoining(false)
    }
  }

  // Returning guest: the name is already on this device, so skip the gate once.
  useEffect(() => {
    if (!open || joined || autoTried.current) return
    const saved = savedGuestName()
    if (!saved || !tenantId || !table?.id) return
    autoTried.current = true
    doJoin(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tenantId, table?.id, joined])

  useEffect(() => { if (!open) autoTried.current = false }, [open])

  const groups = useMemo(() => (session ? splitByGuest(session) : []), [session])
  const total = useMemo(() => (session ? sessionTotal(session) : 0), [session])
  const units = useMemo(() => (session ? sessionCount(session) : 0), [session])
  const share = useMemo(() => (session ? equalShare(session) : 0), [session])
  const lines = Array.isArray(session?.lines) ? session.lines : []

  const onRemove = async (lineId) => {
    setBusyLine(lineId)
    try {
      await removeLine(tenantId, sessionId, lineId, myId)
    } catch (e) {
      toast.error(e?.message === 'not-your-line'
        ? (ar ? 'يمكنك حذف أصنافك أنت فقط' : 'You can only remove your own items')
        : (ar ? 'تعذّر الحذف — تحقق من الاتصال' : 'Could not remove — check your connection'))
    } finally { setBusyLine('') }
  }

  const onQty = async (lineId, qty) => {
    setBusyLine(lineId)
    try {
      await setLineQty(tenantId, sessionId, lineId, qty, myId)
    } catch (e) {
      toast.error(e?.message === 'not-your-line'
        ? (ar ? 'يمكنك تعديل أصنافك أنت فقط' : 'You can only edit your own items')
        : (ar ? 'تعذّر التعديل — تحقق من الاتصال' : 'Could not update — check your connection'))
    } finally { setBusyLine('') }
  }

  const place = async () => {
    if (!lines.length || placing) return
    setPlacing(true)
    try {
      // The parent owns the real createOrder (totals, offers, loyalty, payment).
      const res = await onPlaceOrder?.(lines)
      // Only clear the table basket once the order truly exists.
      if (res !== false) await markOrdered(tenantId, sessionId, res?.id || res || '')
    } catch (_) {
      toast.error(ar ? 'تعذّر إرسال طلب الطاولة — لم يُرسل شيء، أعد المحاولة' : 'Could not send the table order — nothing was sent, retry')
    } finally { setPlacing(false) }
  }

  const title = ar
    ? `الطلب الجماعي${table?.label ? ` · ${table.label}` : ''}`
    : `Shared table${table?.label ? ` · ${table.label}` : ''}`

  // ---- join gate ----
  if (open && !joined) {
    return (
      <Sheet open={open} onClose={onClose} title={title}>
        <div className="tl-join">
          <div className="tl-join-mark"><Icon name="tables" size={26} /></div>
          <h3 className="tl-join-title">{ar ? 'اطلبوا معاً من طاولة واحدة' : 'Order together from one table'}</h3>
          <p className="tl-join-sub">
            {ar
              ? 'اكتب اسمك لينضم جهازك إلى سلة الطاولة — سيرى الجميع ما أضفته، ويُحسب نصيب كل شخص تلقائياً.'
              : 'Enter your name to join the table basket — everyone sees what you add and each share is computed automatically.'}
          </p>
          <input
            className="input tl-join-input"
            value={name}
            maxLength={40}
            placeholder={ar ? 'اسمك' : 'Your name'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doJoin(name) }}
          />
          <button className="btn primary tl-join-btn" disabled={joining || !name.trim()} onClick={() => doJoin(name)}>
            {joining ? <Spinner /> : <><Icon name="user" size={16} /> {ar ? 'انضم إلى الطاولة' : 'Join the table'}</>}
          </button>
          {!table?.id && (
            <p className="tl-note">{ar ? 'هذه الميزة تعمل بعد مسح رمز الطاولة (QR) فقط.' : 'This works only after scanning a table QR code.'}</p>
          )}
          {err && (
            <p className="tl-error">
              {ar ? 'تعذّر فتح جلسة الطاولة' : 'Could not open the table session'}
              {err?.code ? ` (${err.code})` : ''}
            </p>
          )}
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      tall
      footer={session && lines.length > 0 ? (
        <div className="tl-foot">
          <div className="tl-foot-sums">
            <div className="tl-foot-row">
              <span>{ar ? 'إجمالي الطاولة' : 'Table total'}</span>
              <strong><Price value={total} currency={currency} lang={lang} /></strong>
            </div>
            <div className="tl-foot-row tl-foot-alt">
              <span>{ar ? 'تقسيم بالتساوي' : 'Split equally'}</span>
              <span><Price value={share} currency={currency} lang={lang} /> {ar ? 'للفرد' : 'each'}</span>
            </div>
          </div>
          <button className="btn primary tl-send" disabled={placing} onClick={place}>
            {placing ? <Spinner /> : <><Icon name="check" size={16} /> {ar ? 'أرسل طلب الطاولة' : 'Send table order'}</>}
          </button>
        </div>
      ) : null}
    >
      {err ? (
        <div className="tl-state">
          <Icon name="warning" size={22} />
          <p>{ar ? 'انقطع الاتصال بجلسة الطاولة.' : 'Lost connection to the table session.'}</p>
          <p className="tl-note">
            {err?.code === 'permission-denied'
              ? (ar ? 'الطلب الجماعي غير مفعّل لهذه المنشأة، أو انتهت صلاحية الجلسة.' : 'Shared ordering is not enabled here, or the session expired.')
              : (ar ? 'تحقق من الإنترنت ثم أعد فتح النافذة.' : 'Check your connection and reopen this sheet.')}
            {err?.code ? ` (${err.code})` : ''}
          </p>
        </div>
      ) : session === undefined ? (
        <div className="tl-state"><Spinner lg /><p>{ar ? 'نفتح جلسة الطاولة…' : 'Opening the table session…'}</p></div>
      ) : !session ? (
        <div className="tl-state">
          <Icon name="tables" size={22} />
          <p>{ar ? 'لا توجد جلسة لهذه الطاولة بعد.' : 'No session for this table yet.'}</p>
        </div>
      ) : (
        <div className="tl-wrap">
          <div className="tl-people" aria-label={ar ? 'الحاضرون على الطاولة' : 'People at this table'}>
            {groups.map((g) => (
              <div key={g.id} className={`tl-person ${g.id === myId ? 'is-me' : ''}`}>
                <span className="tl-avatar">{initials(g.name)}</span>
                <span className="tl-person-name">{g.id === myId ? (ar ? 'أنت' : 'You') : g.name}</span>
              </div>
            ))}
          </div>

          {groups.length <= 1 && (
            <p className="tl-note tl-alone">
              {ar
                ? 'أنت الوحيد على الطاولة الآن — اطلب من بقية الجالسين مسح نفس رمز الطاولة لينضموا.'
                : 'You are the only one here — ask the others to scan the same table QR to join.'}
            </p>
          )}

          {lines.length === 0 ? (
            <div className="tl-state">
              <Icon name="cart" size={22} />
              <p>{ar ? 'سلة الطاولة فارغة.' : 'The table basket is empty.'}</p>
              <p className="tl-note">{ar ? 'أضف من القائمة وسيظهر الصنف فوراً على أجهزة الجميع.' : 'Add from the menu and it appears on everyone else instantly.'}</p>
            </div>
          ) : (
            <div className="tl-groups">
              {groups.filter((g) => g.lines.length > 0).map((g) => {
                const mine = g.id === myId
                return (
                  <section key={g.id} className={`tl-group ${mine ? 'is-me' : ''}`}>
                    <header className="tl-group-head">
                      <span className="tl-avatar">{initials(g.name)}</span>
                      <strong className="grow">{mine ? (ar ? `${g.name} (أنت)` : `${g.name} (you)`) : g.name}</strong>
                      <Price value={g.total} currency={currency} lang={lang} />
                    </header>
                    <div className="tl-lines">
                      {g.lines.map((l) => (
                        <div key={l.id} className={`tl-line ${busyLine === l.id ? 'is-busy' : ''}`}>
                          {l.imageUrl
                            ? <img className="tl-thumb" src={l.imageUrl} alt="" loading="lazy" />
                            : <span className="tl-thumb tl-thumb-ph"><Icon name="coffee" size={14} /></span>}
                          <div className="grow">
                            <div className="tl-line-name">
                              {(!ar && l.nameEn) ? l.nameEn : l.nameAr}
                              {l.variant?.label ? <span className="tl-variant"> · {l.variant.label}</span> : null}
                            </div>
                            {l.mods?.length ? (
                              <div className="tl-mods">{l.mods.map((m) => ((!ar && m.nameEn) ? m.nameEn : m.nameAr)).join(' · ')}</div>
                            ) : null}
                            <div className="tl-line-price"><Price value={l.lineTotal} currency={currency} lang={lang} /></div>
                          </div>
                          {mine ? (
                            <div className="tl-line-actions">
                              <Stepper value={Number(l.qty) || 1} onChange={(q) => onQty(l.id, q)} min={1} />
                              <button type="button" className="icon-btn tl-del" aria-label={ar ? 'حذف' : 'Remove'} onClick={() => onRemove(l.id)}>
                                <Icon name="delete" size={15} />
                              </button>
                            </div>
                          ) : (
                            <span className="tl-qty-ro" title={ar ? `أضافه ${g.name}` : `Added by ${g.name}`}>{Number(l.qty) || 1}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          )}

          {lines.length > 0 && (
            <p className="tl-note">
              {ar
                ? `${units} صنف على الطاولة · يمكن لكل شخص حذف أصنافه هو فقط.`
                : `${units} items on the table · each guest may remove only their own.`}
            </p>
          )}

          {session.status === 'ordered' && lines.length === 0 && (
            <p className="tl-note tl-sent">{ar ? 'أُرسلت جولة سابقة إلى المطبخ — يمكنكم إضافة جولة جديدة الآن.' : 'A previous round was sent to the kitchen — you can start a new round.'}</p>
          )}
        </div>
      )}
    </Sheet>
  )
}
