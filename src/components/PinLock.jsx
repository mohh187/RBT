import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { watchStaff } from '../lib/db.js'
import { staffHasPin, isUnlocked, clearUnlocked, getPinActor, rememberRoster, getRoster, markUnlocked, tryQuickUnlock, warmPinSignIn } from '../lib/pin.js'
import { useAuth } from '../lib/auth.jsx'
import { useToast } from './Toast.jsx'
import Icon from './Icon.jsx'
import { arPlural } from '../lib/forecast.js'

// Full-screen PIN gate for shared devices — PIN-ONLY entry: the code itself
// identifies the staffer (unique per venue, enforced server-side) and opens
// THEIR real Firebase session via pinSignIn → signInWithCustomToken. Legacy
// duplicate PINs get a one-time name disambiguation among the matches only.
// Themeable (tenant.pinLockStyle), live clock, physical keyboard, haptics,
// demo mode for the Settings preview, and a `standalone` mode for the /lock
// cold-start route (no Firebase user yet — venue identity from device cache).

const vibrate = (p) => { try { navigator.vibrate?.(p) } catch (_) { /* ignore */ } }
// key-press ripple: retrigger the CSS animation (.rip::before) on every tap.
// Class-based (not :active) so a fast tap still plays the full wave.
const rippleFx = (e) => { const b = e.currentTarget; b.classList.remove('rip'); void b.offsetWidth; b.classList.add('rip') }
const hueOf = (name = '') => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h }
const ROLE_AR = { owner: 'مالك', manager: 'مدير', supervisor: 'مشرف', accountant: 'محاسب', cashier: 'كاشير', barista: 'باريستا', kitchen: 'مطبخ', waiter: 'نادل', driver: 'مندوب', marketing: 'تسويق', cleaner: 'نظافة', staff: 'موظف' }

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
      <span className="xs faint">{now.toLocaleDateString('ar-SA-u-nu-latn-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long' })} · {greet}</span>
    </div>
  )
}

export default function PinLock({ tenant, tenantId, demo = false, standalone = false, onSuccess = null }) {
  const enabled = demo || standalone || !!tenant?.pinLock?.enabled
  const idleMin = Number(tenant?.pinLock?.idleMin) || 0
  const st = tenant?.pinLockStyle || {}
  const { logout, pinLogin, user } = useAuth()
  const toast = useToast()
  const [locked, setLocked] = useState(() => demo || standalone || (enabled && !isUnlocked(tenantId)))
  const [staff, setStaff] = useState(() => (standalone ? getRoster(tenantId) : []))
  const [staffLoaded, setStaffLoaded] = useState(standalone)
  const staffRef = useRef(staff)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)
  const [ok, setOk] = useState(false)
  const [okName, setOkName] = useState('')
  const [checking, setChecking] = useState(false)
  // legacy duplicate-PIN disambiguation: { pin, matches:[{uid,name}] }
  const [amb, setAmb] = useState(null)
  const fails = useRef(0)
  const idleTimer = useRef(null)
  const delHold = useRef(null)
  const navigate = useNavigate()
  // false = this lock is an ENTRY (fresh tab / shift start); true = a mid-shift
  // RE-lock (idle timer / manual). Entry unlocks and identity handovers route
  // to the role's home screen; a same-user idle unlock stays exactly where the
  // staffer was working.
  const relock = useRef(false)

  useEffect(() => { if (!demo && !standalone) setLocked(enabled && !isUnlocked(tenantId)) }, [enabled, tenantId, demo, standalone])
  useEffect(() => {
    if (!tenantId || !enabled || standalone) return
    return watchStaff(tenantId, (list) => {
      setStaff(list); staffRef.current = list; setStaffLoaded(true)
      // keep the cold-start roster fresh for the /lock route
      rememberRoster(tenantId, list)
    })
  }, [tenantId, enabled, standalone])

  // manual lock event + idle auto-lock (real mode only). Idle lock is the
  // OVERLAY only — no sign-out — so resume is instant and the Firestore cache
  // stays warm; the explicit button below is the full sign-out.
  useEffect(() => {
    if (!enabled || demo || standalone) return
    const lock = () => { relock.current = true; clearUnlocked(tenantId); setLocked(true); setPin(''); setOk(false); setAmb(null) }
    const onManual = () => {
      const has = staffRef.current.some((s) => staffHasPin(s) && s.active !== false)
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
  }, [enabled, idleMin, locked, tenantId, standalone]) // eslint-disable-line react-hooks/exhaustive-deps

  const realPins = staff.filter((s) => staffHasPin(s) && s.active !== false)
  const withPins = demo && realPins.length === 0
    ? [{ uid: 'd1', name: 'أحمد', role: 'cashier' }, { uid: 'd2', name: 'سارة', role: 'manager' }]
    : realPins
  // the last unlocker greets first in the roster strip (purely informational now)
  const lastId = getPinActor(tenantId)?.id
  const ordered = [...withPins].sort((a, b) => ((b.uid === lastId ? 1 : 0) - (a.uid === lastId ? 1 : 0)))

  const handleRes = (res, usedPin) => {
    setChecking(false)
    if (res.ok) {
      fails.current = 0
      setOk(true)
      setOkName(res.name || '')
      vibrate(30)
      // ROLE ROUTING (owner decision 2026-08-18): a real PIN ENTRY, whether a
      // shift start or the device handed to a DIFFERENT staffer, goes to that
      // role's own working screen (cashier to the POS, kitchen to the KDS,
      // everyone else to the portal). A same-user idle resume stays put.
      //
      // WHY A FLAG AND NOT navigate().
      // pinLogin has ALREADY swapped the Firebase session by the time we get
      // here (it awaits signInWithCustomToken), so onAuthStateChanged has fired,
      // `loading` is true, RequireAuth is showing its spinner, and the admin
      // shell — with this very PinLock inside it — is unmounted. navigate() from
      // an unmounted component does nothing at all, which is exactly why a
      // waiter who PINned in while the screen sat on /admin STAYED on /admin.
      // A sessionStorage marker survives that teardown; PinRedirect in App.jsx
      // reads it once auth settles and sends them to their own screen.
      // Same-user idle resume sets nothing: that staffer stays where they were.
      const sameUser = !!(res.uid && user?.uid && res.uid === user.uid)
      if (!demo && !standalone && !(sameUser && relock.current)) {
        try { sessionStorage.setItem('ml.pin.go', '1') } catch (_) { /* private mode */ }
      }
      // Different-user PINs swap the Firebase session (auth.pinLogin) and the
      // whole tree remounts under the loading gate; same-user PINs just lift
      // this overlay. Either way the unlock markers are already stamped.
      // 260ms: just enough to read the green dots — the wait lives here, not
      // in front of the staffer's next order.
      setTimeout(() => { setLocked(false); setPin(''); setOk(false); onSuccess?.(res) }, 260)
    } else if (res.ambiguous && res.matches?.length) {
      // two legacy staffers share this PIN — one-time pick among the MATCHES only
      setAmb({ pin: usedPin, matches: res.matches })
      setPin('')
    } else if (res.inactive) {
      // CORRECT pin, suspended account — not a wrong-PIN attempt, so it must not
      // increment the attempts-remaining counter or wear the error shake.
      toast.error('حسابك موقوف حالياً. راجع الإدارة لتفعيله')
      setPin('')
    } else if (res.config) {
      // server can't mint the session token (missing IAM role) — NOT a wrong PIN.
      toast.error('الدخول بالرمز غير مفعّل بعد. راجع الدعم لتفعيله')
      setPin('')
    } else if (res.swapFailed) {
      // CORRECT pin — the token was minted but the local session swap failed
      // (network blip mid-swap). Not a wrong-PIN attempt: no counter, no shake.
      toast.error('رمزك صحيح لكن الجلسة ما فتحت. أدخل رمزك مرة ثانية')
      setPin('')
    } else {
      if (res.error) toast.error('ما قدرنا نتحقق من الرمز. تأكد من اتصال الإنترنت وحاول مرة ثانية')
      fails.current = res.locked ? 5 : fails.current + 1
      setErr(true)
      vibrate([60, 40, 60])
      const wait = res.locked ? Math.max(15000, Number(res.waitMs) || 0) : (fails.current >= 5 ? 15000 : 700)
      setTimeout(() => { setErr(false); setPin('') }, wait)
    }
  }

  // hard re-entrancy guard: setChecking(true) does not commit synchronously, so
  // the `checking` state check alone can miss a 5th keypress that re-submits the
  // already-complete 4-digit PIN (two token mints / two counter charges).
  const submitting = useRef(false)
  const press = async (d) => {
    if (err || ok || checking || amb || submitting.current) return
    vibrate(8)
    const next = (pin + d).slice(0, 4)
    if (pin.length >= 4) return // already full — ignore extra taps
    // first digit = clear intent: boot a cold pinSignIn container NOW so its
    // start-up cost is paid while the remaining three digits are typed
    if (!demo && pin.length === 0) warmPinSignIn()
    setPin(next)
    if (next.length < 4) return
    if (demo) { setErr(true); vibrate([60, 40, 60]); setTimeout(() => { setErr(false); setPin('') }, 600); return }
    submitting.current = true
    setChecking(true)
    try {
      // Same-user fast path: the staffer who is ALREADY signed in on this
      // device re-enters their own PIN (the idle-lock case) → verified against
      // this tab's salted digest, zero network, instant. Anything else — other
      // PINs, cold starts, no cache — falls through to the server unchanged.
      if (!standalone && user?.uid && await tryQuickUnlock(tenantId, user.uid, next)) {
        markUnlocked(tenantId)
        handleRes({ ok: true, uid: user.uid, name: getPinActor(tenantId)?.name || '' }, next)
        return
      }
      // Server-side: the PIN identifies the staffer, rate-limited per staffer
      // AND per venue; success mints the custom token that opens their session.
      handleRes(await pinLogin(tenantId, next), next)
    } finally { submitting.current = false }
  }

  const chooseAmb = async (uid) => {
    // same ref guard as press(): state alone misses a fast double-tap across
    // two names → two token mints + a wrongly-charged coworker fail counter
    if (checking || !amb || submitting.current) return
    submitting.current = true
    setChecking(true)
    const { pin: usedPin } = amb
    setAmb(null)
    try { handleRes(await pinLogin(tenantId, usedPin, uid), usedPin) } finally { submitting.current = false }
  }

  // physical keyboard: digits / Backspace / Escape
  useEffect(() => {
    if (!locked) return
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (e.key === 'Escape') { setPin(''); setAmb(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [locked, pin, err, ok, checking, amb]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!demo && !standalone && (!enabled || !locked || !staffLoaded || withPins.length === 0)) return null
  if (standalone && !locked) return null

  const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'del']

  // portaled to <body>: a glass-themed ancestor's backdrop-filter would otherwise
  // become this overlay's containing block and trap the fixed positioning
  return createPortal(
    <div className={`pinlock ${ok ? 'ok' : ''}`} role="dialog" aria-modal="true" data-tone={st.tone || 'auto'} data-shape={st.padShape || 'rounded'} data-hasbg={st.bg?.url ? 'true' : undefined}>
      {st.bg?.url && (
        <div className="pinlock-bglayer" aria-hidden="true" style={{ opacity: st.bgOpacity ?? 0.35 }}>
          {st.bg.kind === 'video'
            // preload=auto buffers immediately; the ref nudge restarts playback
            // if the browser parked autoplay (tab restore, compositor hiccup)
            ? <video src={st.bg.url} autoPlay muted loop playsInline preload="auto" ref={(el) => { if (el && el.paused) el.play().catch(() => {}) }} style={{ objectPosition: st.bgPosition || 'center', transform: Number(st.bgScale) > 1 ? `scale(${Number(st.bgScale)})` : undefined, transformOrigin: st.bgPosition || 'center' }} />
            : <div style={{ backgroundImage: `url(${st.bg.url})`, backgroundPosition: st.bgPosition || 'center', backgroundSize: Number(st.bgScale) > 1 ? `${Number(st.bgScale) * 100}%` : 'cover' }} />}
        </div>
      )}
      <div className="pinlock-box">
        <LockClock st={st} />
        {tenant?.logoUrl && <img src={tenant.logoUrl} alt="" className="pinlock-logo" />}
        <strong style={{ fontSize: 'var(--fs-lg)' }}>{tenant?.name || ''}</strong>
        {amb ? (
          <>
            <p className="small" style={{ margin: 0 }}>رمزك يطابق رمز موظف آخر. اختر اسمك الآن</p>
            <p className="xs faint" style={{ margin: 0 }}>ثم غيّر رمزك من الإعدادات ليكون خاصاً بك</p>
            <div className="pinlock-staff">
              {amb.matches.map((m) => (
                <button key={m.uid} className="pinlock-person" onClick={() => chooseAmb(m.uid)}>
                  <span className="pinlock-avatar" style={{ background: `hsl(${hueOf(m.name)} 55% 45% / .22)`, color: `hsl(${hueOf(m.name)} 60% 38%)` }}>
                    {(m.name || '?').slice(0, 1)}
                  </span>
                  <span className="small bold">{m.name || 'موظف'}</span>
                </button>
              ))}
            </div>
            <button className="btn-link xs faint" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setAmb(null)}>رجوع</button>
          </>
        ) : (
          <>
            <p className="small" style={{ margin: 0 }}>أدخل رمزك لفتح حسابك</p>
            <div className={`pinlock-dots ${err ? 'err' : ''} ${ok ? 'ok' : ''} ${checking ? 'checking' : ''}`}>
              {[0, 1, 2, 3].map((i) => <span key={i} className={pin.length > i ? 'on' : ''} />)}
            </div>
            <div className="pinlock-pad" dir="ltr">
              {PAD.map((k, i) => k === 'clear' ? (
                <button key={k} className="pinlock-alt" style={{ '--i': i }} onPointerDown={rippleFx} onClick={() => setPin('')} aria-label="مسح الكل"><Icon name="close" size={20} /></button>
              ) : k === 'del' ? (
                <button key={k} className="pinlock-alt" style={{ '--i': i }} aria-label="حذف"
                  onClick={() => setPin((p) => p.slice(0, -1))}
                  onPointerDown={(e) => { rippleFx(e); delHold.current = setTimeout(() => setPin(''), 450) }}
                  onPointerUp={() => clearTimeout(delHold.current)}
                  onPointerLeave={() => clearTimeout(delHold.current)}><Icon name="back" size={20} /></button>
              ) : (
                <button key={k} style={{ '--i': i }} onPointerDown={rippleFx} onClick={() => press(k)}>{k}</button>
              ))}
            </div>
            {ok && <p className="xs" style={{ color: 'var(--success)', margin: 0, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={13} /> أهلاً {okName}</p>}
            {!ok && fails.current >= 2 && !err && <p className="xs faint" style={{ margin: 0 }}>بقي لك {arPlural(Math.max(0, 5 - fails.current), { one: 'محاولة', two: 'محاولتان', few: 'محاولات', many: 'محاولة' })} قبل الإيقاف المؤقت</p>}
            {fails.current >= 5 && err && <p className="xs" style={{ color: 'var(--danger)', margin: 0 }}>محاولات كثيرة. انتظر قليلاً ثم جرّب من جديد</p>}
            {/* the team strip — who can unlock here (informational; PIN is the identity) */}
            {ordered.length > 0 && (
              <div className="pinlock-staff pinlock-staff-strip">
                {ordered.slice(0, 6).map((s) => (
                  <span key={s.uid || s.id} className="pinlock-person" style={{ cursor: 'default' }}>
                    <span className="pinlock-avatar" style={s.photoUrl ? undefined : { background: `hsl(${hueOf(s.name)} 55% 45% / .22)`, color: `hsl(${hueOf(s.name)} 60% 38%)` }}>
                      {s.photoUrl ? <img src={s.photoUrl} alt="" /> : (s.name || '?').slice(0, 1)}
                    </span>
                    <span className="xs bold">{s.name || s.displayName || 'موظف'}</span>
                    {s.role && <span className="xs faint">{ROLE_AR[s.role] || s.role}</span>}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
        {!demo && !standalone && (
          <button className="pinlock-link xs" onClick={logout}>
            تسجيل الخروج من الحساب
          </button>
        )}
        {standalone && (
          <a className="pinlock-link xs" href="/login">الدخول بالبريد الإلكتروني</a>
        )}
      </div>
    </div>,
    document.body
  )
}
