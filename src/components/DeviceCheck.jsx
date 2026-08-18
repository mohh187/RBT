import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { useToast } from './Toast.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { db } from '../lib/firebase.js'
import { pushDiag } from '../lib/push.js'
import { unlockAudio, playFromPrefs } from '../lib/sounds.js'
import { getPrefs } from '../lib/notifyPrefs.js'
import { printReceipt } from '../lib/print.js'
import { watchScreens } from '../lib/db.js'
import { SW_VERSION } from '../lib/notify.js'
import { getDeviceVenue } from '../lib/pin.js'
import { timeAgo } from '../lib/format.js'
import {
  getStaffDeviceId, getStaffDeviceName, setStaffDeviceName,
  registerStaffDevice, watchStaffDevices,
} from '../lib/staffDevice.js'

// Screens/devices stamp lastSeenAt differently (Firestore Timestamp vs epoch
// millis) — normalize once so the "online" math never compares apples to Dates.
const toMs = (v) => (v?.toMillis ? v.toMillis() : typeof v === 'number' ? v : 0)

// A signage TV pings while its player runs; 3 minutes of silence = offline.
const SCREEN_ONLINE_MS = 3 * 60 * 1000
// Staff devices beat every 5 minutes (useDeviceHeartbeat) — 6 minutes of
// grace means one on-time beat shows green, one missed beat flips it.
const DEVICE_ONLINE_MS = 6 * 60 * 1000

// Hardcoded sample shaped like a real order (the fields print.js reads):
// what comes out of the printer must look like service, not like a debug dump.
const TEST_ORDER = {
  code: 'TEST-001',
  tableLabel: '',
  items: [
    { nameAr: 'قهوة اليوم', nameEn: 'Coffee of the day', qty: 1, unitPrice: 12, lineTotal: 12 },
    { nameAr: 'كرواسون زعتر', nameEn: 'Zaatar croissant', qty: 2, unitPrice: 9, lineTotal: 18 },
  ],
  subtotal: 30,
  total: 30,
  createdAt: new Date(),
}

// One diagnostic row — same ok/no table style as NotificationSettings' push
// diagnostic (the repo's pattern for "which layer is broken?"). ok === null
// renders a neutral "running" state so a slow probe reads as pending, not failed.
function Row({ label, ok, note, lang }) {
  const pending = ok === null || ok === undefined
  return (
    <div className="row-between" style={{ gap: 8 }}>
      <span className="small">{label}</span>
      {pending ? (
        <span className="xs faint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="clock" size={13} /> {lang === 'ar' ? 'يفحص…' : 'Checking…'}
        </span>
      ) : (
        <span className="xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: ok ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
          <Icon name={ok ? 'ok' : 'no'} size={13} /> {note}
        </span>
      )}
    </div>
  )
}

// The device self-test sheet: proves each layer the shop depends on — network,
// database, alerts, printing, the signage fleet and this device's registration
// — so "nothing is arriving" turns into a specific red row instead of a call.
export default function DeviceCheck({ open, onClose, tenant, tenantId }) {
  const { lang } = useI18n()
  const toast = useToast()
  const ar = lang === 'ar'
  const [runId, setRunId] = useState(0) // bump = re-run the live probes
  const [net, setNet] = useState(null) // { ok, ms?, note? }
  const [dbc, setDbc] = useState(null) // { ok, ms? }
  const [diag, setDiag] = useState(() => pushDiag())
  const [screens, setScreens] = useState([])
  const [devices, setDevices] = useState([])
  const [printed, setPrinted] = useState(null) // null = untested, else boolean from printReceipt
  const [nameDraft, setNameDraft] = useState(() => getStaffDeviceName())
  const myId = getStaffDeviceId()

  // Live probes — run when the sheet opens and on every re-run tap.
  useEffect(() => {
    if (!open) return
    let alive = true
    setNet(null); setDbc(null); setDiag(pushDiag()); setPrinted(null)
    setNameDraft(getStaffDeviceName())

    // 1. Internet — navigator.onLine lies (it only knows about the interface,
    //    not the route out), so a real same-origin fetch with a cache-buster
    //    is the probe; onLine merely short-circuits the obvious case.
    ;(async () => {
      if (!navigator.onLine) return { ok: false, note: ar ? 'النظام يقول: غير متصل' : 'System reports offline' }
      const t0 = Date.now()
      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), 4000)
      try {
        await fetch(`/brand/favicon.png?t=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal })
        return { ok: true, ms: Date.now() - t0 }
      } catch (_) {
        return { ok: false, note: ar ? 'انقطاع فعلي رغم إشارة النظام' : 'Actually down despite the system signal' }
      } finally { clearTimeout(to) }
    })().then((r) => { if (alive) setNet(r) })

    // 2. Database — a timed read of the venue doc itself; 6s is beyond any
    //    healthy Firestore round-trip, so hitting it means "effectively down".
    ;(async () => {
      const t0 = Date.now()
      try {
        await Promise.race([
          getDoc(doc(db, 'tenants', tenantId)),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000)),
        ])
        return { ok: true, ms: Date.now() - t0 }
      } catch (_) { return { ok: false } }
    })().then((r) => { if (alive) setDbc(r) })

    return () => { alive = false }
  }, [open, runId, tenantId, ar])

  // Fleet subscriptions — only while the sheet is open, torn down on close.
  useEffect(() => {
    if (!open || !tenantId) return
    const u1 = watchScreens(tenantId, setScreens)
    const u2 = watchStaffDevices(tenantId, setDevices)
    return () => { u1?.(); u2?.() }
  }, [open, tenantId])

  // unlockAudio must run inside the tap (autoplay policy), then the venue's
  // actual alert sound — testing a DIFFERENT sound would prove nothing.
  const testSound = async () => {
    await unlockAudio()
    playFromPrefs(getPrefs())
  }

  // proforma: a test print must never come out labeled as a real tax invoice
  // (with a ZATCA QR) — it is plumbing, not paperwork.
  const testPrint = async () => {
    const ok = await printReceipt([TEST_ORDER], { tenant, lang: 'ar', title: 'فاتورة تجربة', proforma: true })
    setPrinted(ok)
  }

  const saveName = async () => {
    const n = nameDraft.trim()
    if (!n) return
    setStaffDeviceName(n)
    await registerStaffDevice(tenantId, { name: n })
    toast.success(ar ? 'تم حفظ اسم الجهاز' : 'Device name saved')
  }

  const registerNow = async () => {
    await registerStaffDevice(tenantId, { name: getStaffDeviceName() })
    toast.success(ar ? 'تم تسجيل الجهاز' : 'Device registered')
  }

  const now = Date.now()
  const screensOnline = screens.filter((s) => toMs(s.lastSeenAt) >= now - SCREEN_ONLINE_MS).length
  const registered = devices.some((d) => d.id === myId)
  const standalone = !!(window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone)
  const venue = getDeviceVenue()

  return (
    <Sheet open={open} onClose={onClose} title={ar ? 'فحص الجهاز' : 'Device check'}>
      <div className="stack">
        <button className="btn btn-sm btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => setRunId((x) => x + 1)}>
          <Icon name="reload" size={14} /> {ar ? 'إعادة الفحص' : 'Re-run checks'}
        </button>

        {/* 1. internet */}
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <strong className="small row" style={{ gap: 6 }}><Icon name="wifi" size={14} /> {ar ? 'الإنترنت' : 'Internet'}</strong>
          <Row lang={lang} label={ar ? 'الاتصال الفعلي' : 'Real connectivity'} ok={net ? net.ok : null}
            note={net?.ok ? (ar ? `متصل · ${net.ms}ms` : `Online · ${net.ms}ms`) : (net?.note || (ar ? 'غير متصل' : 'Offline'))} />
        </div>

        {/* 2. database */}
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <strong className="small row" style={{ gap: 6 }}><Icon name="layers" size={14} /> {ar ? 'قاعدة البيانات' : 'Database'}</strong>
          <Row lang={lang} label={ar ? 'قراءة بيانات المنشأة' : 'Venue data read'} ok={dbc ? dbc.ok : null}
            note={dbc?.ok ? (ar ? `تعمل · ${dbc.ms}ms` : `Working · ${dbc.ms}ms`) : (ar ? 'تعذّر الوصول (مهلة 6 ثوانٍ)' : 'Unreachable (6s timeout)')} />
        </div>

        {/* 3. notifications — same three layers the notification settings show */}
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <strong className="small row" style={{ gap: 6 }}><Icon name="bell" size={14} /> {ar ? 'الإشعارات' : 'Notifications'}</strong>
          <Row lang={lang} label={ar ? 'مدعومة على هذا الجهاز' : 'Supported on this device'} ok={diag.supported}
            note={diag.supported ? (ar ? 'مدعومة' : 'Supported') : (ar ? 'غير مدعومة' : 'Unsupported')} />
          <Row lang={lang} label={ar ? 'إذن الإشعارات' : 'Permission'} ok={diag.permission === 'granted'}
            note={diag.permission === 'granted' ? (ar ? 'مسموح' : 'Granted') : diag.permission === 'denied' ? (ar ? 'محظور. فعّله من إعدادات المتصفح' : 'Blocked. Allow it from your browser settings') : (ar ? 'بانتظار التفعيل' : 'Not set')} />
          <Row lang={lang} label={ar ? 'خدمة الدفع (الخادم)' : 'Server push key'} ok={diag.vapid}
            note={diag.vapid ? (ar ? 'مضبوطة' : 'Configured') : (ar ? 'غير مضبوطة' : 'Missing')} />
          <button className="btn btn-sm btn-outline" style={{ alignSelf: 'flex-start' }} onClick={testSound}>
            <Icon name="sound" size={14} /> {ar ? 'اختبار الصوت' : 'Test sound'}
          </button>
        </div>

        {/* 4. printing */}
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <strong className="small row" style={{ gap: 6 }}><Icon name="print" size={14} /> {ar ? 'الطباعة' : 'Printing'}</strong>
          {printed !== null && (
            <Row lang={lang} label={ar ? 'نافذة الطباعة' : 'Print window'} ok={printed}
              note={printed ? (ar ? 'فُتحت' : 'Opened') : (ar ? 'حُظرت' : 'Blocked')} />
          )}
          {printed === false && (
            <p className="xs" style={{ margin: 0, color: 'var(--danger)', lineHeight: 1.6 }}>
              {ar
                ? 'سُمح بالنوافذ المنبثقة؟ افتح من التطبيق المثبّت أو اسمح بالنوافذ لهذا الموقع.'
                : 'Popups allowed? Open from the installed app, or allow popups for this site.'}
            </p>
          )}
          <button className="btn btn-sm btn-outline" style={{ alignSelf: 'flex-start' }} onClick={testPrint}>
            <Icon name="print" size={14} /> {ar ? 'طباعة فاتورة تجريبية' : 'Print a test receipt'}
          </button>
        </div>

        {/* 5. signage screens + staff devices */}
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <strong className="small row" style={{ gap: 6 }}><Icon name="eye" size={14} /> {ar ? 'الأجهزة والشاشات' : 'Devices & screens'}</strong>
          {screens.length > 0 && (
            <Row lang={lang} label={ar ? 'شاشات العرض' : 'Signage screens'} ok={screensOnline === screens.length}
              note={ar ? `${screensOnline} من ${screens.length} متصلة` : `${screensOnline} of ${screens.length} online`} />
          )}
          {devices.length === 0 ? (
            <p className="xs faint" style={{ margin: 0 }}>{ar ? 'لا أجهزة مسجّلة بعد. سجّل هذا الجهاز من الأسفل.' : 'No devices registered yet. Register this one below.'}</p>
          ) : devices.map((d) => {
            const mine = d.id === myId
            const online = toMs(d.lastSeenAt) >= now - DEVICE_ONLINE_MS
            return (
              <div key={d.id} className="list-row" style={{ borderColor: mine ? 'var(--brand)' : 'var(--border)', borderWidth: mine ? 2 : 1, gap: 8 }}>
                <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                  {mine ? (
                    // inline rename — only THIS device can be renamed here, the
                    // one place a name can be verified against physical reality
                    <div className="row" style={{ gap: 6 }}>
                      <input className="input" style={{ minHeight: 34, fontSize: 'var(--fs-sm)' }} value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        aria-label={ar ? 'اسم الجهاز' : 'Device name'} />
                      <button className="btn btn-sm btn-outline" style={{ flex: 'none' }} onClick={saveName}>{ar ? 'حفظ' : 'Save'}</button>
                    </div>
                  ) : (
                    <span className="small bold">{d.name || (ar ? 'جهاز' : 'Device')}</span>
                  )}
                  <span className="xs faint">
                    {d.platform || ''}{mine ? ` · ${ar ? 'هذا الجهاز' : 'this device'}` : ''}
                  </span>
                </div>
                <span className="xs" style={{ flex: 'none', fontWeight: 700, color: online ? 'var(--success)' : 'var(--danger)' }}>
                  {online ? (ar ? 'متصل الآن' : 'Online now') : (ar ? `آخر ظهور ${timeAgo(toMs(d.lastSeenAt), lang)}` : `Last seen ${timeAgo(toMs(d.lastSeenAt), lang)}`)}
                </span>
              </div>
            )
          })}
        </div>

        {/* 6. this device */}
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <strong className="small row" style={{ gap: 6 }}><Icon name="settings" size={14} /> {ar ? 'هذا الجهاز' : 'This device'}</strong>
          <Row lang={lang} label={ar ? 'مسجّل لدى المنشأة' : 'Registered with the venue'} ok={registered}
            note={registered ? (ar ? 'مسجّل' : 'Registered') : (ar ? 'غير مسجّل بعد' : 'Not yet')} />
          <Row lang={lang} label={ar ? 'مثبّت كتطبيق' : 'Installed as an app'} ok={standalone}
            note={standalone ? (ar ? 'مثبّت' : 'Installed') : (ar ? 'يعمل من المتصفح' : 'Running in browser')} />
          <Row lang={lang} label={ar ? 'المنشأة محفوظة على الجهاز' : 'Venue remembered'} ok={!!venue}
            note={venue ? (venue.name || (ar ? 'محفوظة' : 'Saved')) : (ar ? 'غير محفوظة' : 'Not saved')} />
          <div className="row-between" style={{ gap: 8 }}>
            <span className="small">{ar ? 'إصدار التطبيق' : 'App version'}</span>
            <span className="xs num faint" dir="ltr">{SW_VERSION}</span>
          </div>
          {!registered && (
            <button className="btn btn-sm btn-primary" style={{ alignSelf: 'flex-start' }} onClick={registerNow}>
              <Icon name="ok" size={14} /> {ar ? 'تسجيل هذا الجهاز الآن' : 'Register this device now'}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
