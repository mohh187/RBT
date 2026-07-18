import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Sheet from '../../components/Sheet.jsx'
import Icon from '../../components/Icon.jsx'
import Lightbox from '../../components/Lightbox.jsx'
import { recordAttendance, watchMyAttendance, watchAttendance, watchStaff } from '../../lib/db.js'
import { uploadImage } from '../../lib/storage.js'

// Haversine distance in metres.
function metres(a, b) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}
function getGeo() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  })
}
function fmtTime(ts, lang) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
  if (!d) return ''
  return d.toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

// Is today a working day for this staffer? Off days (or unset workDays = all days).
function isWorkDay(staffer) {
  const wd = new Date().getDay()
  const days = Array.isArray(staffer?.workDays) ? staffer.workDays : null
  return !days || !days.length ? true : days.includes(wd)
}
// Smart lateness: clock-in vs THIS staffer's own shift start (+ general grace),
// then the auto deduction from the general policy. Off days are NEVER counted late.
function computeLateness(staffer, tenant) {
  const shiftStart = staffer?.shiftStart
  if (!shiftStart) return { lateMinutes: 0, deduction: 0 }
  if (!isWorkDay(staffer)) return { lateMinutes: 0, deduction: 0, off: true }
  const [h, m] = String(shiftStart).split(':').map(Number)
  const now = new Date()
  const start = new Date(now); start.setHours(h || 0, m || 0, 0, 0)
  const grace = Number(tenant?.attendancePolicy?.graceMinutes) || 0
  const lateMinutes = Math.max(0, Math.round((now.getTime() - start.getTime()) / 60000) - grace)
  const rate = Number(tenant?.attendancePolicy?.lateDeductionPerHour) || 0
  const deduction = lateMinutes > 0 && rate > 0 ? Math.round((lateMinutes / 60) * rate) : 0
  return { lateMinutes, deduction }
}

export default function Attendance() {
  const { t, lang } = useI18n()
  const { tenantId, tenant, user, profile, isManager } = useAuth()
  const toast = useToast()
  const ar = lang === 'ar'
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [mine, setMine] = useState(null)
  const [team, setTeam] = useState([])
  const [me, setMe] = useState(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('me')
  const [camOpen, setCamOpen] = useState(false)
  const [camError, setCamError] = useState('')
  const [zoom, setZoom] = useState('')
  const [page, setPage] = useState(0)
  const PAGE = 10

  const venueGeo = tenant?.geo && Number.isFinite(tenant.geo.lat) ? tenant.geo : null
  const radius = Number(tenant?.geofenceRadius) || 200

  useEffect(() => { if (!tenantId || !user) return; return watchMyAttendance(tenantId, user.uid, setMine) }, [tenantId, user])
  useEffect(() => { if (!tenantId || !isManager) return; return watchAttendance(tenantId, setTeam) }, [tenantId, isManager])
  useEffect(() => { if (!tenantId || !user) return; return watchStaff(tenantId, (list) => setMe(list.find((x) => x.uid === user.uid) || null)) }, [tenantId, user])
  useEffect(() => () => stopCam(), []) // stop camera on unmount
  useEffect(() => { setPage(0) }, [tab])

  const lastType = mine?.[0]?.type
  const clockedIn = lastType === 'in'
  const nextType = clockedIn ? 'out' : 'in'
  // late RIGHT NOW if they clock in (pre-emptive warning) / late on the active shift (persistent)
  const offToday = !isWorkDay(me)
  const wouldBeLate = !clockedIn && me?.shiftStart ? computeLateness(me, tenant) : { lateMinutes: 0, deduction: 0 }
  const lateNow = clockedIn && (mine?.[0]?.lateMinutes || 0) > 0 ? mine[0] : null

  function stopCam() {
    if (streamRef.current) { streamRef.current.getTracks().forEach((tr) => tr.stop()); streamRef.current = null }
  }
  const closeCamera = () => { stopCam(); setCamOpen(false) }

  const openCamera = async () => {
    setCamError('')
    setCamOpen(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}) }
    } catch (_) {
      setCamError(ar ? 'تعذّر فتح الكاميرا — تتطلّب HTTPS وإذن الكاميرا.' : 'Cannot open camera — needs HTTPS + camera permission.')
    }
  }

  const capture = async () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const max = 720, scale = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight))
    const cv = document.createElement('canvas')
    cv.width = Math.round(v.videoWidth * scale)
    cv.height = Math.round(v.videoHeight * scale)
    cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height)
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.82))
    closeCamera()
    if (!blob) { toast.error(t('error')); return }
    await submitPunch(new File([blob], `selfie-${Date.now()}.jpg`, { type: 'image/jpeg' }))
  }

  const submitPunch = async (file) => {
    setBusy(true)
    try {
      const geo = await getGeo()
      const selfieUrl = await uploadImage(tenantId, file, 'attendance')
      let withinGeofence = null, distance = null
      if (geo && venueGeo) { distance = Math.round(metres(geo, venueGeo)); withinGeofence = distance <= radius }
      const late = nextType === 'in' ? computeLateness(me, tenant) : { lateMinutes: 0, deduction: 0 }
      await recordAttendance(tenantId, {
        staffUid: user.uid,
        staffName: profile?.displayName || user.displayName || user.email || '',
        type: nextType,
        selfieUrl,
        geo: geo || null,
        distance,
        withinGeofence,
        lateMinutes: late.lateMinutes,
        deduction: late.deduction,
        device: navigator.userAgent.slice(0, 120),
      })
      if (nextType === 'in' && late.lateMinutes > 0) {
        toast.error(ar
          ? `تم تسجيل حضورك — لكنك متأخّر ${late.lateMinutes} دقيقة${late.deduction ? ` وسيُحتسب خصم ${late.deduction}` : '، ويُحتسب كتأخير'}`
          : `Clocked in — you're ${late.lateMinutes}m late${late.deduction ? `, deduction ${late.deduction}` : ', counted as late'}`)
      } else {
        toast.success(nextType === 'in' ? (ar ? 'تم تسجيل حضورك' : 'Clocked in') : (ar ? 'تم تسجيل انصرافك' : 'Clocked out'))
      }
    } catch (_) {
      toast.error(t('error'))
    } finally {
      setBusy(false)
    }
  }

  if (mine === null) return <Spinner />

  const Row = ({ r }) => (
    <div className="list-row" style={{ alignItems: 'center' }}>
      {r.selfieUrl ? <img src={r.selfieUrl} alt="" onClick={() => setZoom(r.selfieUrl)} style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover', flex: 'none', cursor: 'zoom-in' }} /> : <span className="center" style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--surface-2)', flex: 'none' }}><Icon name="user" size={18} /></span>}
      <div className="grow">
        <div className="small bold row" style={{ gap: 6 }}>
          {tab === 'team' && <span>{r.staffName || '—'} ·</span>}
          <span style={{ color: r.type === 'in' ? 'var(--success)' : 'var(--text-muted)' }}>{r.type === 'in' ? (ar ? 'حضور' : 'In') : (ar ? 'انصراف' : 'Out')}</span>
        </div>
        <div className="xs faint">{fmtTime(r.at, lang)}</div>
        {r.type === 'in' && r.lateMinutes > 0 && (
          <div className="xs" style={{ color: 'var(--warning)' }}>{ar ? `تأخّر ${r.lateMinutes} د` : `Late ${r.lateMinutes}m`}{r.deduction ? ` · −${r.deduction}` : ''}</div>
        )}
      </div>
      {r.withinGeofence === true && <span className="badge badge-success"><Icon name="pin" size={12} /> {ar ? 'داخل الموقع' : 'On-site'}</span>}
      {r.withinGeofence === false && <span className="badge badge-danger"><Icon name="pin" size={12} /> {r.distance != null ? `${r.distance}م` : (ar ? 'خارج الموقع' : 'Off-site')}</span>}
    </div>
  )

  return (
    <div className="page stack">
      <h2 className="page-title row" style={{ gap: 8 }}><Icon name="scan" size={22} /> {ar ? 'الحضور والانصراف' : 'Attendance'}</h2>

      <div className="card card-pad stack center" style={{ gap: 14, textAlign: 'center' }}>
        <span className="center" style={{ width: 72, height: 72, borderRadius: '50%', background: clockedIn ? 'var(--success-soft)' : 'var(--surface-2)', color: clockedIn ? 'var(--success)' : 'var(--text-muted)' }}>
          <Icon name={clockedIn ? 'ok' : 'clock'} size={34} />
        </span>
        <div>
          <div className="bold" style={{ fontSize: 'var(--fs-md)' }}>{clockedIn ? (ar ? 'أنت في الدوام' : 'You are clocked in') : (ar ? 'خارج الدوام' : 'You are clocked out')}</div>
          {mine[0] && <div className="xs faint">{ar ? 'آخر تسجيل' : 'Last'}: {fmtTime(mine[0].at, lang)}</div>}
        </div>
        {lateNow && (
          <div className="badge badge-danger" style={{ padding: '8px 12px', textAlign: 'center', width: '100%' }}>
            <Icon name="clock" size={14} /> {ar ? `سجّلت تأخيراً ${lateNow.lateMinutes} دقيقة اليوم${lateNow.deduction ? ` · خصم ${lateNow.deduction}` : ''}` : `You clocked in ${lateNow.lateMinutes}m late today${lateNow.deduction ? ` · −${lateNow.deduction}` : ''}`}
          </div>
        )}
        {!clockedIn && wouldBeLate.lateMinutes > 0 && (
          <div className="badge badge-gold" style={{ padding: '8px 12px', textAlign: 'center', width: '100%' }}>
            <Icon name="clock" size={14} /> {ar ? `أنت متأخّر ${wouldBeLate.lateMinutes} دقيقة — سيُحتسب عند التسجيل${wouldBeLate.deduction ? ` (خصم ${wouldBeLate.deduction})` : ''}` : `You're ${wouldBeLate.lateMinutes}m late — will be recorded${wouldBeLate.deduction ? ` (−${wouldBeLate.deduction})` : ''}`}
          </div>
        )}
        {offToday && (
          <div className="badge badge-success" style={{ padding: '8px 12px', textAlign: 'center', width: '100%' }}>
            <Icon name="calendar" size={14} /> {ar ? 'اليوم إجازتك — لا يُحتسب تأخير أو غياب' : "It's your day off — no lateness or absence counted"}
          </div>
        )}
        <button className={`btn btn-lg btn-block ${clockedIn ? 'btn-outline' : 'btn-primary'}`} disabled={busy} onClick={openCamera}>
          <Icon name="camera" size={18} /> {busy ? t('saving') : nextType === 'in' ? (ar ? 'تسجيل حضور (كاميرا)' : 'Clock in (camera)') : (ar ? 'تسجيل انصراف (كاميرا)' : 'Clock out (camera)')}
        </button>
        <p className="xs faint">
          {venueGeo ? (ar ? `تُلتقط الصورة بالكاميرا فقط مع الوقت والموقع (نطاق ${radius}م).` : `Photo is taken by camera only, with time + location (within ${radius}m).`) : (ar ? 'الصورة بالكاميرا فقط. حدّد موقع المنشأة من الإعدادات لتفعيل التحقق.' : 'Camera only. Set the venue location in Settings to verify on-site.')}
        </p>
      </div>

      {isManager && (
        <div className="row" style={{ gap: 8 }}>
          <button className={`chip ${tab === 'me' ? 'active' : ''}`} onClick={() => setTab('me')}>{ar ? 'سجلّي' : 'My log'}</button>
          <button className={`chip ${tab === 'team' ? 'active' : ''}`} onClick={() => setTab('team')}>{ar ? 'سجل الفريق' : 'Team log'}</button>
        </div>
      )}

      {(() => {
        const list = tab === 'team' ? team : (mine || [])
        const pages = Math.ceil(list.length / PAGE)
        const shown = list.slice(page * PAGE, page * PAGE + PAGE)
        return (
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {list.length === 0 ? (
              <Empty icon="clock" title={ar ? 'لا سجلّات بعد' : 'No records yet'} />
            ) : (
              <>
                {shown.map((r) => <Row key={r.id} r={r} />)}
                {pages > 1 && (
                  <div className="row" style={{ justifyContent: 'center', gap: 12, alignItems: 'center', paddingTop: 'var(--sp-2)' }}>
                    <button className="btn btn-sm btn-outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><Icon name={ar ? 'next' : 'back'} size={16} /></button>
                    <span className="small faint">{page + 1} / {pages}</span>
                    <button className="btn btn-sm btn-outline" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}><Icon name={ar ? 'back' : 'next'} size={16} /></button>
                  </div>
                )}
              </>
            )}
          </div>
        )
      })()}

      {/* camera-only capture */}
      <Sheet open={camOpen} onClose={closeCamera} title={ar ? 'التقط صورتك' : 'Take your photo'}
        footer={<button className="btn btn-primary btn-lg btn-block" disabled={!!camError} onClick={capture}><Icon name="camera" size={18} /> {ar ? 'التقاط' : 'Capture'}</button>}>
        <div className="stack center" style={{ gap: 12 }}>
          {camError ? (
            <div className="badge badge-danger" style={{ padding: 12, textAlign: 'center' }}>{camError}</div>
          ) : (
            <video ref={videoRef} playsInline muted style={{ width: '100%', maxWidth: 360, borderRadius: 'var(--r-lg)', background: '#000', transform: 'scaleX(-1)' }} />
          )}
          <p className="xs faint">{ar ? 'لا يمكن رفع صورة — الكاميرا فقط.' : 'No uploads — camera only.'}</p>
        </div>
      </Sheet>

      <Lightbox src={zoom} onClose={() => setZoom('')} />
    </div>
  )
}
