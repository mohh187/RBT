import { useEffect, useState } from 'react'
import Sheet from './Sheet.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'
import { useToast } from './Toast.jsx'
import { getPrefs, setPrefs } from '../lib/notifyPrefs.js'
import { SOUNDS, playPreset, playCustom, playFromPrefs, unlockAudio } from '../lib/sounds.js'
import { requestNotifyPermission, registerSW, showNotification, notifyState, pushCapability, isIOS } from '../lib/notify.js'
import { pushDiag } from '../lib/push.js'
import Icon from './Icon.jsx'

export default function NotificationSettings({ open, onClose }) {
  const { t, lang } = useI18n()
  const { tenantId, user } = useAuth()
  const toast = useToast()
  const [p, setP] = useState(getPrefs())
  const [diag, setDiag] = useState(() => pushDiag())
  const [iosGuide, setIosGuide] = useState(false)
  const ar = lang === 'ar'
  const cap = pushCapability() // 'ios-needs-install' | 'unsupported' | 'ready'

  // refresh the push diagnostic whenever the sheet opens (permission/token may have changed)
  useEffect(() => { if (open) { setDiag(pushDiag()); setIosGuide(false) } }, [open])

  const update = (patch) => setP(setPrefs(patch))

  const enable = async () => {
    await unlockAudio()
    // iOS/Safari can't show the permission prompt in a plain tab — the app must be
    // added to the Home Screen first. Guide the user there instead of a dead button.
    if (cap === 'ios-needs-install') { setIosGuide(true); update({ enabled: true }); playFromPrefs(getPrefs()); return }
    const granted = await requestNotifyPermission()
    await registerSW()
    update({ enabled: true })
    if (!granted) toast.error(t('notifBlocked'))
    else {
      toast.success(t('notifEnabledMsg'))
      // register this device for push (no-op unless VAPID key configured + staff)
      if (tenantId) import('../lib/push.js').then((m) => m.initPush(tenantId, user?.uid)).then(() => setTimeout(() => setDiag(pushDiag()), 800)).catch(() => {})
    }
    // immediate confirmation sound
    playFromPrefs(getPrefs())
  }

  const preview = async (soundId) => {
    await unlockAudio()
    if (soundId === 'custom' && p.customSoundUrl) playCustom(p.customSoundUrl, { volume: p.volume, loops: 1 })
    else playPreset(soundId, { volume: p.volume, loops: 1 })
  }

  const selectSound = (soundId) => {
    update({ soundId })
    preview(soundId)
  }

  const onFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 1.5 * 1024 * 1024) {
      toast.error(lang === 'ar' ? 'الملف كبير (الحد 1.5 ميجابايت)' : 'File too big (max 1.5MB)')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      update({ customSoundUrl: reader.result, soundId: 'custom' })
      toast.success(lang === 'ar' ? 'تم رفع الصوت' : 'Sound uploaded')
    }
    reader.readAsDataURL(f)
  }

  const test = async () => {
    await unlockAudio()
    playFromPrefs(getPrefs())
    showNotification(lang === 'ar' ? 'تجربة تنبيه' : 'Test alert', {
      body: lang === 'ar' ? 'هكذا سيصلك التنبيه' : 'This is how alerts look',
      tag: 'test',
    })
  }

  const state = notifyState()

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('notifSettings')}
      footer={<button className="btn btn-primary btn-lg btn-block" onClick={test}>{t('testAlert')}</button>}
    >
      <div className="stack">
        {/* enable */}
        <div className="card card-pad row-between" style={{ background: p.enabled ? 'var(--success-soft)' : 'var(--surface-2)' }}>
          <div>
            <strong>{t('enableNotifications')}</strong>
            <p className="xs faint" style={{ marginTop: 2 }}>{t('notifHint')}</p>
          </div>
          {p.enabled ? (
            <button className="btn btn-sm btn-outline" onClick={() => update({ enabled: false })}>{lang === 'ar' ? 'إيقاف' : 'Off'}</button>
          ) : (
            <button className="btn btn-sm btn-primary" onClick={enable}>{lang === 'ar' ? 'تفعيل' : 'On'}</button>
          )}
        </div>

        {state === 'denied' && (
          <div className="badge badge-danger" style={{ justifyContent: 'center', padding: 10 }}>{t('notifBlocked')}</div>
        )}

        {/* iPhone/iPad: Apple only allows web-push for an INSTALLED app. Show the
            exact one-time steps — after this, the permission prompt appears once. */}
        {(iosGuide || (cap === 'ios-needs-install' && state !== 'granted')) && (
          <div className="card card-pad stack" style={{ gap: 10, borderColor: 'var(--brand)' }}>
            <strong className="small row" style={{ gap: 6 }}><Icon name="bell" size={15} style={{ color: 'var(--brand)' }} /> {ar ? 'لتفعيل الإشعارات على الآيفون' : 'Enable notifications on iPhone'}</strong>
            <p className="xs faint" style={{ margin: 0, lineHeight: 1.7 }}>
              {ar ? 'يمنع نظام آبل الإشعارات في المتصفح مباشرة — يجب إضافة التطبيق للشاشة الرئيسية أولاً (مرة واحدة)، وبعدها تظهر نافذة الموافقة تلقائياً.' : 'Apple only allows notifications for an installed app. Add it to the Home Screen once — then the permission prompt appears automatically.'}
            </p>
            <div className="stack" style={{ gap: 8 }}>
              {[
                [<>{ar ? 'اضغط زر المشاركة' : 'Tap Share'} <Icon name="share" size={15} style={{ verticalAlign: 'middle' }} /> {ar ? 'في شريط سفاري بالأسفل' : 'in the Safari bar'}</>],
                [<>{ar ? 'اختر «إضافة إلى الشاشة الرئيسية»' : 'Choose “Add to Home Screen”'} <Icon name="addToHome" size={15} style={{ verticalAlign: 'middle' }} /></>],
                [ar ? 'افتح التطبيق من الأيقونة الجديدة على الشاشة الرئيسية' : 'Open the app from the new Home Screen icon'],
                [ar ? 'اضغط «تفعيل» هنا — وستظهر نافذة السماح مرة واحدة' : 'Tap “On” here — the allow prompt shows once'],
              ].map((row, i) => (
                <div key={i} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                  <span className="num" style={{ flex: 'none', width: 22, height: 22, borderRadius: '50%', background: 'var(--brand)', color: 'var(--on-brand)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800 }}>{i + 1}</span>
                  <span className="small" style={{ lineHeight: 1.5 }}>{row}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* background-push diagnostic — shows exactly which layer works so the
            "browser closed, no alert" problem is diagnosable at a glance */}
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <strong className="small row" style={{ gap: 6 }}><Icon name="bell" size={14} /> {ar ? 'إشعارات التطبيق المغلق' : 'Closed-app notifications'}</strong>
          {(() => {
            const rows = [
              [ar ? 'إذن الإشعارات' : 'Permission', diag.permission === 'granted', diag.permission === 'granted' ? (ar ? 'مسموح' : 'Granted') : diag.permission === 'denied' ? (ar ? 'محظور — فعّله من إعدادات المتصفح' : 'Blocked in browser') : (ar ? 'بانتظار التفعيل' : 'Not set')],
              [ar ? 'خدمة الدفع (الخادم)' : 'Server push key', diag.vapid, diag.vapid ? (ar ? 'مضبوطة' : 'Configured') : (ar ? 'غير مضبوطة — يلزم مفتاح VAPID' : 'Missing VAPID key')],
              [ar ? 'هذا الجهاز مُسجّل' : 'This device registered', diag.registered, diag.registered ? (ar ? 'مُسجّل للإشعارات' : 'Registered') : (ar ? 'غير مُسجّل بعد' : 'Not yet')],
            ]
            return rows.map(([label, ok, note], i) => (
              <div key={i} className="row-between" style={{ gap: 8 }}>
                <span className="small">{label}</span>
                <span className="xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: ok ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
                  <Icon name={ok ? 'ok' : 'no'} size={13} /> {note}
                </span>
              </div>
            ))
          })()}
          {!diag.vapid && (
            <p className="xs faint" style={{ margin: 0, lineHeight: 1.6 }}>
              {ar
                ? 'الإشعارات تصل الآن فقط والتطبيق مفتوح. لتصل والمتصفح مغلق يلزم ضبط مفتاح الخادم (VAPID) ونشر الدوال — راجع مدير النظام.'
                : 'Alerts currently arrive only while the app is open. Closed-app push needs the server VAPID key + deployed functions.'}
            </p>
          )}
        </div>

        {/* sound picker */}
        <div className="field">
          <label>{t('notifSound')}</label>
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {SOUNDS.map((s) => (
              <div key={s.id} className={`list-row ${p.soundId === s.id ? '' : ''}`} style={{ borderColor: p.soundId === s.id ? 'var(--brand)' : 'var(--border)', borderWidth: p.soundId === s.id ? 2 : 1 }}>
                <button className="grow row" style={{ gap: 10 }} onClick={() => selectSound(s.id)}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--brand)', display: 'grid', placeItems: 'center' }}>
                    {p.soundId === s.id ? <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--brand)' }} /> : null}
                  </span>
                  <span className="bold">{s.name[lang] || s.name.ar}</span>
                </button>
                <button className="icon-btn" onClick={() => preview(s.id)} aria-label="play">▶</button>
              </div>
            ))}

            {/* custom sound row */}
            {p.customSoundUrl && (
              <div className="list-row" style={{ borderColor: p.soundId === 'custom' ? 'var(--brand)' : 'var(--border)', borderWidth: p.soundId === 'custom' ? 2 : 1 }}>
                <button className="grow row" style={{ gap: 10 }} onClick={() => selectSound('custom')}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--brand)', display: 'grid', placeItems: 'center' }}>
                    {p.soundId === 'custom' ? <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--brand)' }} /> : null}
                  </span>
                  <span className="bold">{t('customSound')}</span>
                </button>
                <button className="icon-btn" onClick={() => preview('custom')} aria-label="play">▶</button>
              </div>
            )}
          </div>
        </div>

        {/* upload custom */}
        <label className="btn btn-outline btn-block" style={{ cursor: 'pointer' }}>
          <Icon name="upload" size={14} style={{ verticalAlign: 'middle', marginInlineEnd: 4 }} /> {t('uploadSound')}
          <input type="file" accept="audio/*" hidden onChange={onFile} />
        </label>

        {/* volume */}
        <div className="field">
          <label>{t('volume')} · {Math.round(p.volume * 100)}%</label>
          <input
            type="range"
            min="0.2"
            max="3"
            step="0.1"
            value={p.volume}
            onChange={(e) => update({ volume: Number(e.target.value) })}
            style={{ width: '100%', accentColor: 'var(--brand)', height: 32 }}
          />
          <span className="xs faint">{lang === 'ar' ? 'حتى 300% لصوت عالٍ جداً' : 'Up to 300% for very loud alerts'}</span>
        </div>

        {/* repeat */}
        <label className="row-between" style={{ cursor: 'pointer' }}>
          <span className="small">{t('repeatAlert')}</span>
          <input type="checkbox" checked={p.loop} onChange={(e) => update({ loop: e.target.checked })} style={{ width: 22, height: 22 }} />
        </label>
      </div>
    </Sheet>
  )
}
