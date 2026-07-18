import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { watchStaff } from '../lib/db.js'
import { hashPin, isUnlocked, markUnlocked, clearUnlocked, setPinActor, getPinActor } from '../lib/pin.js'
import { useAuth } from '../lib/auth.jsx'
import { useToast } from './Toast.jsx'
import Icon from './Icon.jsx'

// Full-screen PIN gate for shared devices — themeable (tenant.pinLockStyle),
// with live clock/greeting, physical-keyboard support, haptics, success/error
// motion, and a demo mode for the Settings live preview.
// demo=true → always shown, fake staff if none, wrong PINs just shake.

const vibrate = (p) => { try { navigator.vibrate?.(p) } catch (_) { /* ignore */ } }
const hueOf = (name = '') => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h }
const ROLE_AR = { manager: 'مدير', cashier: 'كاشير', kitchen: 'مطبخ', waiter: 'نادل' }

// Apple-style customizable clock: font / size / 12-24h come from pinLockStyle.
function LockClock({ st = {} }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 20000); return () => clearInterval(id) }, [])
  if (st.clockShow === false) return null
  const h = now.getHours()
  const greet = h < 12 ? 'صباح الخير' : h < 17 ? 'طاب يومك' : 'مساء الخير'
  // 24h → 13:11, 00:30… (h23) · 12h → 1:11 PM / 12:30 AM (Latin meridiem per user rule)
  const time = st.clockFormat === '12'
    ? now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return (
    <div className="pinlock-clock">
      <span className="pinlock-time num" dir="ltr" data-font={st.clockFont || 'default'} data-size={st.clockSize || 'md'}>{time}</span>
      <span className="xs faint">{now.toLocaleDateString('ar-SA-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' })} · {greet}</span>
    </div>
  )
}

export default function PinLock({ tenant, tenantId, demo = false }) {
  const enabled = demo || !!tenant?.pinLock?.enabled
  const idleMin = Number(tenant?.pinLock?.idleMin) || 0
  const st = tenant?.pinLockStyle || {}
  const { logout } = useAuth()
  const toast = useToast()
  const [locked, setLocked] = useState(() => demo || (enabled && !isUnlocked(tenantId)))
  const [staff, setStaff] = useState([])
  const [staffLoaded, setStaffLoaded] = useState(false)
  const staffRef = useRef([])
  const [sel, setSel] = useState(null)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)
  const [ok, setOk] = useState(false)
  const [checking, setChecking] = useState(false)
  const fails = useRef(0)
  const idleTimer = useRef(null)
  const delHold = useRef(null)

  useEffect(() => { if (!demo) setLocked(enabled && !isUnlocked(tenantId)) }, [enabled, tenantId, demo])
  useEffect(() => {
    if (!tenantId || !enabled) return
    return watchStaff(tenantId, (list) => { setStaff(list); staffRef.current = list; setStaffLoaded(true) })
  }, [tenantId, enabled])

  // manual lock event + idle auto-lock (real mode only)
  useEffect(() => {
    if (!enabled || demo) return
    const lock = () => { clearUnlocked(tenantId); setLocked(true); setSel(null); setPin(''); setOk(false) }
    const onManual = () => {
      const has = staffRef.current.some((s) => s.pinHash && s.active !== false)
      if (!has) { toast.error('عيّن رمز PIN لموظف واحد على الأقل أولاً (الإعدادات ← قفل PIN)'); return }
      lock()
    }
    const resetIdle = () => {
      if (!idleMin || locked) return
      clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(lock, idleMin * 60 * 1000)
    }
    window.addEventListener('ml:pinlock', onManual)
    window.addEventListener('pointerdown', resetIdle)
    window.addEventListener('keydown', resetIdle)
    // upload progress counts as activity — a long video upload must not get
    // locked away mid-flight by the idle timer
    window.addEventListener('ml:upload', resetIdle)
    resetIdle()
    return () => {
      window.removeEventListener('ml:pinlock', onManual)
      window.removeEventListener('pointerdown', resetIdle)
      window.removeEventListener('keydown', resetIdle)
      window.removeEventListener('ml:upload', resetIdle)
      clearTimeout(idleTimer.current)
    }
  }, [enabled, idleMin, locked, tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  const realPins = staff.filter((s) => s.pinHash && s.active !== false)
  const withPins = demo && realPins.length === 0
    ? [{ uid: 'd1', name: 'أحمد', role: 'cashier' }, { uid: 'd2', name: 'سارة', role: 'manager' }]
    : realPins
  // the last staff member who unlocked this device comes first + is preselected
  const lastId = getPinActor(tenantId)?.id
  const ordered = [...withPins].sort((a, b) => ((b.uid === lastId ? 1 : 0) - (a.uid === lastId ? 1 : 0)))

  useEffect(() => {
    if (!locked || sel || !ordered.length) return
    if (demo) setSel(ordered[0])
    else if (lastId && ordered[0]?.uid === lastId) setSel(ordered[0])
  }, [locked, ordered.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const press = async (d) => {
    if (err || ok || checking) return
    vibrate(8)
    const next = (pin + d).slice(0, 4)
    setPin(next)
    if (next.length < 4 || !sel) return
    if (demo) { setErr(true); vibrate([60, 40, 60]); setTimeout(() => { setErr(false); setPin('') }, 600); return }
    setChecking(true)
    const h = await hashPin(tenantId, next)
    setChecking(false)
    if (h === sel.pinHash) {
      fails.current = 0
      setOk(true)
      vibrate(30)
      setPinActor(tenantId, { id: sel.uid || sel.id, name: sel.name || sel.displayName || '' })
      markUnlocked(tenantId)
      setTimeout(() => { setLocked(false); setSel(null); setPin(''); setOk(false) }, 420)
    } else {
      fails.current += 1
      setErr(true)
      vibrate([60, 40, 60])
      setTimeout(() => { setErr(false); setPin('') }, fails.current >= 5 ? 15000 : 700)
    }
  }

  // physical keyboard: digits / Backspace / Escape
  useEffect(() => {
    if (!locked || !sel) return
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (e.key === 'Escape') { setSel(null); setPin('') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [locked, sel, pin, err, ok, checking]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!demo && (!enabled || !locked || !staffLoaded || withPins.length === 0)) return null

  const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'del']

  // portaled to <body>: a glass-themed ancestor's backdrop-filter would otherwise
  // become this overlay's containing block and trap the fixed positioning
  return createPortal(
    <div className={`pinlock ${ok ? 'ok' : ''}`} role="dialog" aria-modal="true" data-tone={st.tone || 'auto'} data-shape={st.padShape || 'rounded'} data-hasbg={st.bg?.url ? 'true' : undefined}>
      {st.bg?.url && (
        <div className="pinlock-bglayer" aria-hidden="true" style={{ opacity: st.bgOpacity ?? 0.35 }}>
          {st.bg.kind === 'video'
            ? <video src={st.bg.url} autoPlay muted loop playsInline style={{ objectPosition: st.bgPosition || 'center', transform: Number(st.bgScale) > 1 ? `scale(${Number(st.bgScale)})` : undefined, transformOrigin: st.bgPosition || 'center' }} />
            : <div style={{ backgroundImage: `url(${st.bg.url})`, backgroundPosition: st.bgPosition || 'center', backgroundSize: Number(st.bgScale) > 1 ? `${Number(st.bgScale) * 100}%` : 'cover' }} />}
        </div>
      )}
      <div className="pinlock-box">
        <LockClock st={st} />
        {tenant?.logoUrl && <img src={tenant.logoUrl} alt="" className="pinlock-logo" />}
        <strong style={{ fontSize: 'var(--fs-lg)' }}>{tenant?.name || ''}</strong>
        {!sel ? (
          <>
            <p className="small faint" style={{ margin: 0 }}>اختر اسمك لفتح النظام</p>
            <div className="pinlock-staff">
              {withPins.length === 0
                ? <p className="small faint">لا موظفين برمز PIN — عيّن الأرقام من الإعدادات ← قفل PIN</p>
                : ordered.map((s) => (
                  <button key={s.uid || s.id} className="pinlock-person" onClick={() => { setSel(s); setPin('') }}>
                    <span className="pinlock-avatar" style={s.photoUrl ? undefined : { background: `hsl(${hueOf(s.name)} 55% 45% / .22)`, color: `hsl(${hueOf(s.name)} 60% 38%)` }}>
                      {s.photoUrl ? <img src={s.photoUrl} alt="" /> : (s.name || '?').slice(0, 1)}
                    </span>
                    <span className="small bold">{s.name || s.displayName || '—'}</span>
                    {s.role && <span className="xs faint">{ROLE_AR[s.role] || s.role}</span>}
                  </button>
                ))}
            </div>
          </>
        ) : (
          <>
            <p className="small" style={{ margin: 0 }}>
              <strong>{sel.name}</strong>{sel.role ? <span className="faint"> · {ROLE_AR[sel.role] || sel.role}</span> : null} — أدخل رمزك
            </p>
            <div className={`pinlock-dots ${err ? 'err' : ''} ${ok ? 'ok' : ''} ${checking ? 'checking' : ''}`}>
              {[0, 1, 2, 3].map((i) => <span key={i} className={pin.length > i ? 'on' : ''} />)}
            </div>
            <div className="pinlock-pad" dir="ltr">
              {PAD.map((k, i) => k === 'back' ? (
                <button key={k} className="pinlock-alt" style={{ '--i': i }} onClick={() => { setSel(null); setPin('') }} aria-label="رجوع"><Icon name="undo" size={20} /></button>
              ) : k === 'del' ? (
                <button key={k} className="pinlock-alt" style={{ '--i': i }} aria-label="حذف"
                  onClick={() => setPin((p) => p.slice(0, -1))}
                  onPointerDown={() => { delHold.current = setTimeout(() => setPin(''), 450) }}
                  onPointerUp={() => clearTimeout(delHold.current)}
                  onPointerLeave={() => clearTimeout(delHold.current)}><Icon name="back" size={20} /></button>
              ) : (
                <button key={k} style={{ '--i': i }} onClick={() => press(k)}>{k}</button>
              ))}
            </div>
            {ok && <p className="xs" style={{ color: 'var(--success)', margin: 0, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={13} /> أهلاً {sel.name}</p>}
            {!ok && fails.current >= 2 && !err && <p className="xs faint" style={{ margin: 0 }}>متبقٍ {Math.max(0, 5 - fails.current)} محاولات قبل الإيقاف المؤقت</p>}
            {fails.current >= 5 && err && <p className="xs" style={{ color: 'var(--danger)', margin: 0 }}>محاولات كثيرة — انتظر قليلاً</p>}
          </>
        )}
        {!demo && (
          <button className="btn-link xs faint" style={{ background: 'none', border: 'none', cursor: 'pointer', marginTop: 6 }} onClick={logout}>
            تسجيل الخروج من الحساب
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}
