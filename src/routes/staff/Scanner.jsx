import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import Icon from '../../components/Icon.jsx'
import { getTicket, getReservation, setTicketStatus, setReservationStatus, getMemberByToken } from '../../lib/db.js'
import { chime } from '../../lib/notify.js'
import { unlockAudio } from '../../lib/sounds.js'
import { orderNumber } from '../../lib/format.js'
import { TIER_META } from '../../lib/membership.js'
import CustomerCard from '../../components/CustomerCard.jsx'
import { systemThemeAttr, useSystemThemeBody } from '../../lib/systemThemes.js'

function parseScan(text) {
  try {
    const u = new URL(text)
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts[0] === 'pass') return { type: 'pass', slug: parts[1], kind: parts[2], id: parts[3], token: u.searchParams.get('t') } // ['pass', slug, kind, id]
    if (parts[0] === 'mcard') return { type: 'member', slug: parts[1], token: parts[2] } // ['mcard', slug, token]
    return null
  } catch (_) {
    return null
  }
}

export default function Scanner() {
  const { t, lang, toggleTheme, theme } = useI18n()
  const { tenantId, tenant } = useAuth()
  useSystemThemeBody(tenant, 'admin')
  const toast = useToast()
  const scannerRef = useRef(null)
  const runningRef = useRef(false)  // camera actually running — NOT the stale `scanning` state
  const handledRef = useRef(false)  // process exactly one accepted scan per session
  const [scanning, setScanning] = useState(false)
  const [torch, setTorch] = useState(false)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [memPhone, setMemPhone] = useState(null)

  // Gate on the ref (always current), not the `scanning` state captured stale in
  // the html5-qrcode success closure — otherwise the camera never stops and the
  // decode callback re-fires ~10x/s (runaway beep + hang).
  const stop = async () => {
    if (!scannerRef.current || !runningRef.current) { runningRef.current = false; setScanning(false); return }
    runningRef.current = false
    try {
      await scannerRef.current.stop()
      scannerRef.current.clear()
    } catch (_) { /* already stopped */ }
    setScanning(false)
    setTorch(false)
  }

  // Flashlight for dim rooms — best-effort; not all cameras expose a torch.
  const toggleTorch = async () => {
    if (!scannerRef.current || !runningRef.current) return
    try {
      await scannerRef.current.applyVideoConstraints({ advanced: [{ torch: !torch }] })
      setTorch(!torch)
    } catch (_) {
      toast.error(lang === 'ar' ? 'الفلاش غير مدعوم على هذه الكاميرا' : 'Flash not supported on this camera')
    }
  }

  useEffect(() => () => { stop() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handle = async (text) => {
    if (handledRef.current) return // ignore the ~10fps frame flood — one scan only
    handledRef.current = true
    await stop()
    const p = parseScan(text)
    if (!p) { setResult({ ok: false }); return }
    if (p.type === 'member') {
      const member = await getMemberByToken(tenantId, p.token).catch(() => null)
      if (!member?.active) { setResult({ ok: false }); return }
      chime()
      setResult({ ok: true, type: 'member', member })
      return
    }
    if (!['ticket', 'reservation'].includes(p.kind)) { setResult({ ok: false }); return }
    const getter = p.kind === 'ticket' ? getTicket : getReservation
    const doc = await getter(tenantId, p.id).catch(() => null)
    if (!doc || doc.qrToken !== p.token) { setResult({ ok: false }); return }
    chime()
    setResult({ ok: true, type: 'pass', kind: p.kind, doc })
  }

  const start = async () => {
    setResult(null)
    handledRef.current = false
    unlockAudio() // this tap is the user gesture that lets the confirmation beep play
    try {
      if (!scannerRef.current) scannerRef.current = new Html5Qrcode('reader')
      runningRef.current = true
      setScanning(true)
      await scannerRef.current.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, handle, () => {})
    } catch (_) {
      runningRef.current = false
      setScanning(false)
      toast.error(lang === 'ar' ? 'تعذّر فتح الكاميرا' : 'Camera unavailable')
    }
  }

  const checkIn = async () => {
    if (!result?.ok) return
    setBusy(true)
    try {
      if (result.kind === 'ticket') await setTicketStatus(tenantId, result.doc.id, 'used')
      else await setReservationStatus(tenantId, result.doc.id, 'done')
      setResult({ ...result, doc: { ...result.doc, status: result.kind === 'ticket' ? 'used' : 'done' } })
      toast.success(t('checkedIn'))
    } catch (_) {
      toast.error(t('error'))
    } finally {
      setBusy(false)
    }
  }

  const d = result?.doc
  const isTicket = result?.kind === 'ticket'
  const alreadyDone = d && (d.status === 'used' || d.status === 'done')
  const canCheckIn = d && (isTicket ? d.status === 'valid' : d.status === 'confirmed')
  const title = !d ? '' : isTicket
    ? (lang === 'en' && d.eventTitleEn ? d.eventTitleEn : d.eventTitleAr)
    : ({ birthday: t('birthday'), gathering: t('gathering'), meeting: t('meeting'), other: t('otherOccasion') }[d.occasion] || t('reservationWord'))

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)' }} data-systheme={systemThemeAttr(tenant, 'admin')}>
      <header className="app-bar">
        <Link to="/cashier" className="icon-btn"><Icon name="back" /></Link>
        <strong className="row" style={{ gap: 6, fontSize: 'var(--fs-md)' }}><Icon name="scan" size={18} /> {t('scan')}</strong>
        <div className="grow" />
        <button className="icon-btn" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
      </header>

      <div className="container page stack" style={{ alignItems: 'center', gap: 'var(--sp-4)' }}>
        <div id="reader" style={{ width: '100%', maxWidth: 380, borderRadius: 'var(--r-lg)', overflow: 'hidden', display: scanning ? 'block' : 'none' }} />

        {!scanning && !result && (
          <div className="stack center" style={{ gap: 'var(--sp-3)', textAlign: 'center', paddingTop: 'var(--sp-8)' }}>
            <Icon name="scan" size={56} className="muted" />
            <p className="muted small">{t('scanTicket')}</p>
            <button className="btn btn-primary btn-lg" onClick={start}><Icon name="scan" size={18} /> {t('startScan')}</button>
          </div>
        )}

        {scanning && (
          <>
            <p className="muted small" style={{ textAlign: 'center', margin: 0 }}>{lang === 'ar' ? 'وجّه الكاميرا نحو رمز QR' : 'Point the camera at the QR code'}</p>
            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              <button className={`btn ${torch ? 'btn-primary' : 'btn-outline'}`} onClick={toggleTorch}><Icon name="zap" size={16} /> {lang === 'ar' ? 'الفلاش' : 'Flash'}</button>
              <button className="btn btn-outline" onClick={stop}>{t('cancel')}</button>
            </div>
          </>
        )}

        {result && (
          <div className="card card-pad stack" style={{ width: '100%', maxWidth: 380, alignItems: 'center', gap: 'var(--sp-3)', textAlign: 'center' }}>
            {!result.ok ? (
              <>
                <div className="center" style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--danger-soft)', color: 'var(--danger)' }}><Icon name="no" size={34} /></div>
                <strong style={{ color: 'var(--danger)' }}>{t('invalidPass')}</strong>
              </>
            ) : result.type === 'member' ? (
              <>
                {(() => { const meta = TIER_META[result.member.tier] || TIER_META.silver; return (
                  <>
                    {/* TIER_META has icon/color (no emoji field — this circle rendered empty) */}
                    <div className="center" style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--success-soft)', color: meta.color }}><Icon name={meta.icon || 'award'} size={30} /></div>
                    <strong style={{ fontSize: 'var(--fs-md)' }}>{result.member.name || (lang === 'ar' ? 'عضو' : 'Member')}</strong>
                    <div className="small muted">{lang === 'ar' ? meta.ar : meta.en} · {result.member.points || 0} {lang === 'ar' ? 'نقطة' : 'pts'} · {result.member.discountPct || 0}%</div>
                  </>
                ) })()}
                <button className="btn btn-success btn-lg btn-block" onClick={() => setMemPhone(result.member.phone)}><Icon name="star" size={18} /> {lang === 'ar' ? 'فتح البطاقة (نقاط/خصم)' : 'Open card (points/discount)'}</button>
              </>
            ) : (
              <>
                <div className="center" style={{ width: 64, height: 64, borderRadius: '50%', background: alreadyDone ? 'var(--warning-soft)' : 'var(--success-soft)', color: alreadyDone ? 'var(--warning)' : 'var(--success)' }}>
                  <Icon name={alreadyDone ? 'clock' : 'ok'} size={34} />
                </div>
                <strong style={{ fontSize: 'var(--fs-md)' }}>{title}</strong>
                <div className="small muted">{orderNumber(d.code)} · {d.name || d.phone}</div>
                {isTicket && d.typeName && <span className="badge"><Icon name="ticket" size={13} /> {d.typeName}</span>}
                {alreadyDone ? (
                  <span className="badge badge-warning">{t('alreadyUsed')}</span>
                ) : canCheckIn ? (
                  <button className="btn btn-success btn-lg btn-block" disabled={busy} onClick={checkIn}><Icon name="check" size={18} /> {t('checkIn')}</button>
                ) : (
                  <span className="badge badge-danger">{t(d.status === 'requested' ? 'requested' : 'invalidPass')}</span>
                )}
              </>
            )}
            <button className="btn btn-outline btn-block" onClick={start}><Icon name="scan" size={16} /> {lang === 'ar' ? 'مسح آخر' : 'Scan another'}</button>
          </div>
        )}
      </div>

      {memPhone && <CustomerCard tid={tenantId} phone={memPhone} onClose={() => setMemPhone(null)} />}
    </div>
  )
}
