import { useEffect, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n, pickLang } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { watchScreens, createScreen, updateScreen, deleteScreen, watchCategories, watchItems, watchOffers } from '../../lib/db.js'
import { uploadImage, uploadFile } from '../../lib/storage.js'
import Sheet from '../../components/Sheet.jsx'
import MediaLibrary from '../../components/MediaLibrary.jsx'
import SlideDesigner from '../../components/SlideDesigner.jsx'
import DesignSlideView, { newLayerId } from '../../components/DesignSlideView.jsx'
import { qrDataUrl } from '../../lib/qr.js'

// One-tap pairing: QR + direct ?code link — the TV auto-pairs on open.
function PairPanel({ screenId, ar, toast }) {
  const [qr, setQr] = useState('')
  const link = `${typeof location !== 'undefined' ? location.origin : ''}/screen?code=${screenId}`
  useEffect(() => { qrDataUrl(link, { width: 220 }).then(setQr).catch(() => {}) }, [link])
  const copy = () => navigator.clipboard?.writeText(link).then(() => toast.success(ar ? 'نُسخ الرابط' : 'Copied')).catch(() => {})
  return (
    <div className="row" style={{ gap: 12, alignItems: 'center', padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 10, flexWrap: 'wrap' }}>
      {qr && <img src={qr} alt="" style={{ width: 84, height: 84, borderRadius: 8, background: '#fff', padding: 4, flex: 'none' }} />}
      <div className="stack grow" style={{ gap: 4, minWidth: 180 }}>
        <strong className="small">{ar ? 'اربط هذه الشاشة' : 'Pair this screen'}</strong>
        <span className="xs faint">{ar ? 'امسح الرمز بأي جهاز، أو افتح الرابط مباشرة على التلفزيون — يرتبط تلقائياً بلا إدخال رمز.' : 'Scan the QR or open the link on the TV — it pairs automatically.'}</span>
        <span className="xs" dir="ltr" style={{ wordBreak: 'break-all', fontFamily: 'monospace' }}>{link}</span>
      </div>
      <button className="btn btn-sm btn-outline" style={{ flex: 'none' }} onClick={copy}><Icon name="copy" size={14} /> {ar ? 'نسخ الرابط' : 'Copy link'}</button>
    </div>
  )
}

// Digital signage manager: create screens (pairing codes), build each screen's
// playlist (images / videos / live menu slides). The TV opens /screen and
// enters the code — content updates in realtime after every change here.
export default function ScreensAdmin() {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const { tenantId, tenant } = useAuth()
  const toast = useToast()
  const [screens, setScreens] = useState(null)
  const [cats, setCats] = useState([])
  const [items, setItems] = useState([])
  const [offers, setOffers] = useState([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState(null) // expanded screen editor
  const [designer, setDesigner] = useState(null) // { screenId, index|null, slide }
  const [tplFor, setTplFor] = useState(null) // screenId → templates gallery sheet
  const [schedFor, setSchedFor] = useState(null) // { screenId, index } → inline slide scheduler
  const [mediaLibFor, setMediaLibFor] = useState(null) // screenId → pick a slide from the library
  const [groupFilter, setGroupFilter] = useState('') // '' = show all screen groups

  useEffect(() => { if (!tenantId) return; return watchScreens(tenantId, setScreens) }, [tenantId])
  useEffect(() => { if (!tenantId) return; return watchCategories(tenantId, setCats) }, [tenantId])
  useEffect(() => { if (!tenantId) return; return watchItems(tenantId, setItems) }, [tenantId])
  useEffect(() => { if (!tenantId) return; return watchOffers(tenantId, setOffers) }, [tenantId])

  // live data for binding previews (designer canvas + playlist thumbnails)
  const liveData = { items, offers, venue: tenant }

  const create = async () => {
    if (busy) return
    setBusy(true)
    try {
      const code = await createScreen(tenantId, name.trim() || (ar ? 'شاشة العرض' : 'Screen'))
      setName(''); setOpenId(code)
      toast.success(ar ? `أُنشئت — الرمز: ${code}` : `Created — code: ${code}`)
    } catch (e) {
      toast.error((e?.code || '').includes('permission') ? (ar ? 'انشر قواعد Firestore أولاً' : 'Deploy Firestore rules first') : t('error'))
    } finally { setBusy(false) }
  }

  const addSlide = async (s, slide) => {
    try { await updateScreen(s.id, { items: [...(s.items || []), slide] }) } catch (_) { toast.error(t('error')) }
  }
  const patchItems = (s, items) => updateScreen(s.id, { items }).catch(() => toast.error(t('error')))

  // design slides (canvas editor) — new slide seeded with a headline layer
  const newDesignSlide = () => ({
    type: 'design',
    duration: 10,
    bg: { kind: 'color', color: '#101826', color2: '#3b0d0d', angle: 135 },
    layers: [{ id: newLayerId(), type: 'text', x: 8, y: 34, w: 84, h: 32, content: ar ? 'عرض اليوم' : "Today's offer", fs: 9, color: '#ffffff', weight: 900, align: 'center', shadow: true }],
  })

  // ready-made template gallery — seeded with the venue brand color + live bindings
  const templates = () => {
    const brand = tenant?.brandColor || tenant?.themeColor || '#7c2d2d'
    const firstItem = items[0]?.id || ''
    const T = (x) => ({ id: newLayerId(), ...x })
    return [
      {
        name: ar ? 'عرض اليوم (حي)' : 'Live offer',
        slide: {
          type: 'design', duration: 12, bg: { kind: 'color', color: '#12080a', color2: brand, angle: 150 },
          layers: [
            T({ type: 'shape', x: -14, y: -30, w: 42, h: 74, shape: 'circle', color: '#ffffff', opacity: 0.08 }),
            T({ type: 'text', x: 6, y: 12, w: 88, h: 14, content: ar ? 'عرض اليوم' : "Today's offer", fs: 4.4, color: '#ffd9a8', weight: 800, align: 'center', shadow: true }),
            T({ type: 'text', x: 6, y: 28, w: 88, h: 26, content: ar ? 'خصم خاص' : 'Special deal', fs: 9, color: '#ffffff', weight: 900, align: 'center', shadow: true, binding: { kind: 'offerTitle' } }),
            T({ type: 'text', x: 6, y: 56, w: 88, h: 20, content: '', fs: 12, color: '#ffe08a', weight: 900, align: 'center', shadow: true, binding: { kind: 'offerValue' } }),
            T({ type: 'text', x: 26, y: 80, w: 48, h: 12, content: ar ? 'اطلب الآن' : 'Order now', fs: 3.4, color: '#ffffff', weight: 700, align: 'center', shadow: false, binding: { kind: 'offerCode' } }),
          ],
        },
      },
      {
        name: ar ? 'صنف مميز (حي)' : 'Featured item',
        slide: {
          type: 'design', duration: 10, bg: { kind: 'color', color: '#0d1117', color2: '#1c2431', angle: 160 },
          layers: [
            T({ type: 'shape', x: 55, y: -20, w: 60, h: 140, shape: 'circle', color: brand, opacity: 0.25 }),
            T({ type: 'text', x: 8, y: 22, w: 50, h: 22, content: ar ? 'صنفنا المميز' : 'Our favorite', fs: 6.5, color: '#ffffff', weight: 900, align: 'start', shadow: true, binding: firstItem ? { kind: 'itemName', itemId: firstItem } : null },),
            T({ type: 'text', x: 8, y: 48, w: 40, h: 16, content: '', fs: 7.5, color: '#ffd9a8', weight: 900, align: 'start', shadow: true, binding: firstItem ? { kind: 'itemPrice', itemId: firstItem } : null }),
            T({ type: 'text', x: 8, y: 68, w: 44, h: 10, content: ar ? 'جرّبه اليوم' : 'Try it today', fs: 3, color: '#c9d2e0', weight: 700, align: 'start', shadow: false }),
          ],
        },
      },
      {
        name: ar ? 'امسح المنيو (QR)' : 'Scan the menu',
        slide: {
          type: 'design', duration: 10, bg: { kind: 'color', color: brand, color2: '#14090b', angle: 200 },
          layers: [
            T({ type: 'text', x: 8, y: 10, w: 84, h: 16, content: ar ? 'منيونا بين يديك' : 'Menu in your hands', fs: 6, color: '#ffffff', weight: 900, align: 'center', shadow: true }),
            T({ type: 'qr', x: 39, y: 30, w: 22, h: 40, qrKind: 'menu', radius: 2 }),
            T({ type: 'text', x: 14, y: 76, w: 72, h: 12, content: ar ? 'امسح الرمز واطلب من جوالك' : 'Scan to order from your phone', fs: 3.4, color: '#ffe9d2', weight: 700, align: 'center', shadow: false }),
          ],
        },
      },
      {
        name: ar ? 'ترحيب' : 'Welcome',
        slide: {
          type: 'design', duration: 8, bg: { kind: 'color', color: '#0c0f14', color2: '#22140d', angle: 130 },
          layers: [
            T({ type: 'shape', x: 20, y: 44, w: 60, h: 1.6, shape: 'rect', color: brand, opacity: 0.9, radius: 1 }),
            T({ type: 'text', x: 6, y: 22, w: 88, h: 20, content: ar ? 'أهلاً وسهلاً' : 'Welcome', fs: 9, color: '#ffffff', weight: 900, align: 'center', shadow: true }),
            T({ type: 'text', x: 10, y: 50, w: 80, h: 14, content: tenant?.name || (ar ? 'في ضيافتنا' : 'Enjoy your stay'), fs: 4.6, color: '#e8d9c4', weight: 700, align: 'center', shadow: false }),
          ],
        },
      },
      {
        name: ar ? 'ساعات العمل' : 'Opening hours',
        slide: {
          type: 'design', duration: 9, bg: { kind: 'color', color: '#101418', color2: '#1a2026', angle: 145 },
          layers: [
            T({ type: 'text', x: 8, y: 12, w: 84, h: 16, content: ar ? 'ساعات العمل' : 'Opening hours', fs: 6, color: '#ffffff', weight: 900, align: 'center', shadow: true }),
            T({ type: 'shape', x: 30, y: 30, w: 40, h: 1.2, shape: 'rect', color: brand, opacity: 1, radius: 1 }),
            T({ type: 'text', x: 14, y: 38, w: 72, h: 40, content: ar ? 'السبت – الخميس: 7ص – 12م\nالجمعة: 2م – 12م' : 'Sat–Thu: 7am – 12am\nFri: 2pm – 12am', fs: 4.2, color: '#dfe6ee', weight: 700, align: 'center', shadow: false }),
          ],
        },
      },
      {
        name: ar ? 'إعلان عام' : 'Announcement',
        slide: {
          type: 'design', duration: 9, bg: { kind: 'color', color: '#151016', color2: '#241222', angle: 120 },
          layers: [
            T({ type: 'shape', x: 6, y: 64, w: 88, h: 24, shape: 'rect', color: '#ffffff', opacity: 0.1, radius: 2.4 }),
            T({ type: 'text', x: 8, y: 18, w: 84, h: 30, content: ar ? 'عنوان الإعلان هنا' : 'Your headline here', fs: 8, color: '#ffffff', weight: 900, align: 'center', shadow: true }),
            T({ type: 'text', x: 10, y: 68, w: 80, h: 16, content: ar ? 'تفاصيل إضافية قصيرة تكتبها من المصمم' : 'Short supporting details go here', fs: 3.4, color: '#e6dcea', weight: 700, align: 'center', shadow: false }),
          ],
        },
      },
      {
        name: ar ? 'رمضاني' : 'Ramadan',
        slide: {
          type: 'design', duration: 10, bg: { kind: 'color', color: '#0c1024', color2: '#1c1436', angle: 160 },
          layers: [
            T({ type: 'shape', x: 70, y: 8, w: 16, h: 28, shape: 'circle', color: '#e8c774', opacity: 0.85 }),
            T({ type: 'shape', x: 66, y: 6, w: 16, h: 28, shape: 'circle', color: '#0c1024', opacity: 1 }),
            T({ type: 'text', x: 8, y: 30, w: 84, h: 22, content: 'رمضان كريم', fs: 9, color: '#f4e3b2', weight: 900, align: 'center', shadow: true }),
            T({ type: 'text', x: 12, y: 56, w: 76, h: 14, content: ar ? 'أجواء رمضانية وعروض الإفطار بانتظاركم' : 'Ramadan atmosphere & iftar offers await', fs: 3.8, color: '#d9d2ec', weight: 700, align: 'center', shadow: false }),
          ],
        },
      },
      {
        name: ar ? 'اليوم الوطني' : 'National day',
        slide: {
          type: 'design', duration: 10, bg: { kind: 'color', color: '#06281c', color2: '#0a3d2a', angle: 140 },
          layers: [
            T({ type: 'shape', x: 6, y: 70, w: 88, h: 18, shape: 'rect', color: '#ffffff', opacity: 0.08, radius: 2.4 }),
            T({ type: 'text', x: 8, y: 24, w: 84, h: 24, content: ar ? 'عيد وطني سعيد' : 'Happy National Day', fs: 8.4, color: '#ffffff', weight: 900, align: 'center', shadow: true }),
            T({ type: 'text', x: 10, y: 52, w: 80, h: 12, content: ar ? 'دام عزّك يا وطن — عروض خاصة باليوم الوطني' : 'Special National Day offers', fs: 3.8, color: '#cfe8dc', weight: 700, align: 'center', shadow: false }),
          ],
        },
      },
    ]
  }
  const saveDesign = async (slide) => {
    const s = (screens || []).find((x) => x.id === designer?.screenId)
    if (!s) { setDesigner(null); return }
    try {
      if (designer.index == null) await updateScreen(s.id, { items: [...(s.items || []), slide] })
      else { const items = [...(s.items || [])]; items[designer.index] = slide; await updateScreen(s.id, { items }) }
      toast.success(t('saved'))
      setDesigner(null)
    } catch (_) { toast.error(t('error')) }
  }

  const onMedia = async (s, e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || busy) return
    setBusy(true)
    try {
      const isV = f.type.startsWith('video/')
      const url = isV ? await uploadFile(tenantId, f, 'signage') : await uploadImage(tenantId, f, 'signage')
      await addSlide(s, { type: isV ? 'video' : 'image', url, duration: isV ? 0 : 8 })
    } catch (_) { toast.error(t('error')) } finally { setBusy(false) }
  }

  if (screens === null) return <Spinner />

  // screen groups (free-text screen.group): distinct names + the filtered list.
  // Filtering is display-only; «تطبيق على المجموعة» lives in each screen's ops row.
  const groups = [...new Set(screens.map((x) => (x.group || '').trim()).filter(Boolean))]
  const shown = groupFilter ? screens.filter((x) => (x.group || '').trim() === groupFilter) : screens

  return (
    <div className="page stack" style={{ gap: 'var(--sp-3)' }}>
      <h2 className="page-title">{ar ? 'شاشات العرض' : 'Display screens'}</h2>

      <div className="card card-pad stack" style={{ gap: 8 }}>
        <p className="xs faint" style={{ margin: 0 }}>{ar ? 'افتح /screen على أي تلفزيون أو جهاز بمتصفح، وأدخل رمز الشاشة — المحتوى يتحدث لحظياً مع كل تعديل هنا.' : 'Open /screen on any TV browser and enter the code — content updates live.'}</p>
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" placeholder={ar ? 'اسم الشاشة (الصالة، الواجهة…)' : 'Screen name'} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-primary" style={{ flex: 'none' }} disabled={busy} onClick={create}><Icon name="add" size={16} /> {ar ? 'إنشاء شاشة' : 'Create'}</button>
        </div>

        {/* Every honest way to put this on a screen — no vague promises */}
        <details>
          <summary className="small bold" style={{ cursor: 'pointer', listStyle: 'none' }}><Icon name="qr" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'طرق ربط الشاشات والأجهزة' : 'Ways to connect screens'}</summary>
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            {[
              [ar ? 'أي تلفزيون ذكي أو جهاز بمتصفح' : 'Any smart TV / browser device', ar ? 'افتح رابط الشاشة المباشر (أو امسح QR من بطاقة الشاشة بالأسفل) — يرتبط تلقائياً ويعمل فوراً.' : 'Open the screen link (or scan its QR) — pairs automatically.'],
              [ar ? 'أندرويد TV / شاشة إعلانات' : 'Android TV / signage box', ar ? 'ثبّت أي متصفح، افتح الرابط مرة واحدة، وفعّل «ملء الشاشة» من زر المشغل — يعود تلقائياً عند إعادة التشغيل مع صفحة بدء المتصفح.' : 'Install a browser, open the link once, use the player fullscreen button.'],
              [ar ? 'البث من جوالك أو لابتوبك (Chromecast / AirPlay)' : 'Cast from phone/laptop', ar ? 'افتح الرابط في كروم واضغط «إرسال / Cast» لأي شاشة على نفس الشبكة، أو AirPlay من سفاري.' : 'Open in Chrome and Cast, or AirPlay from Safari.'],
              [ar ? 'عبر شبكة الواي فاي المحلية' : 'Over local Wi-Fi', ar ? 'أي جهاز على شبكتك يفتح الرابط يعمل فوراً — والتحكم (إيقاف/التالي/الموسيقى) يصل من لوحتك خلال ثوانٍ لحظياً. لا حاجة لخادم محلي.' : 'Any device on your network opening the link works instantly; remote control applies within seconds.'],
              [ar ? 'وضع الكشك (تشغيل دائم)' : 'Kiosk mode', ar ? 'على أندرويد استخدم تطبيق Kiosk Browser وثبّت الرابط؛ على أجهزة التلفزيون اجعل المتصفح يفتح تلقائياً مع التشغيل.' : 'Use a kiosk browser app with the link as home.'],
            ].map(([h, b], i) => (
              <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-start', padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 10 }}>
                <Icon name="check" size={14} style={{ color: 'var(--success)', flex: 'none', marginTop: 2 }} />
                <div className="stack" style={{ gap: 2 }}><strong className="small">{h}</strong><span className="xs faint">{b}</span></div>
              </div>
            ))}
          </div>
        </details>
      </div>

      {/* group filter chips — appear once any screen has a group name */}
      {groups.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="xs faint">{ar ? 'المجموعات:' : 'Groups:'}</span>
          <button className={`btn btn-sm ${groupFilter === '' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setGroupFilter('')}>{ar ? 'الكل' : 'All'} ({screens.length})</button>
          {groups.map((g) => (
            <button key={g} className={`btn btn-sm ${groupFilter === g ? 'btn-primary' : 'btn-outline'}`} onClick={() => setGroupFilter(groupFilter === g ? '' : g)}>
              {g} ({screens.filter((x) => (x.group || '').trim() === g).length})
            </button>
          ))}
        </div>
      )}

      {screens.length === 0 ? (
        <Empty icon="qr" title={ar ? 'لا شاشات بعد' : 'No screens yet'} hint={ar ? 'أنشئ شاشة واعرض منيوك على أي تلفزيون' : 'Create one and show your menu on any TV'} />
      ) : shown.map((s) => (
        <div key={s.id} className="card card-pad stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong className="grow">{s.name || s.id}</strong>
            {/* health: TVs heartbeat lastSeenAt every 75s */}
            {(() => {
              const seen = Number(s.lastSeenAt) || 0
              const mins = seen ? Math.round((Date.now() - seen) / 60000) : null
              return mins == null
                ? <span className="badge">{ar ? 'لم تتصل بعد' : 'Never connected'}</span>
                : mins < 3
                  ? <span className="badge badge-success">{ar ? 'متصلة الآن' : 'Online'}{(s.items || []).length ? ` · ${ar ? 'شريحة' : 'slide'} ${(Number(s.nowIdx) % Math.max(1, (s.items || []).length)) + 1}` : ''}</span>
                  : <span className="badge badge-warning">{ar ? `آخر اتصال منذ ${mins < 60 ? `${mins} د` : `${Math.round(mins / 60)} س`}` : `Seen ${mins}m ago`}</span>
            })()}
            {(s.group || '').trim() && <span className="badge">{s.group}</span>}
            <span className="badge badge-gold num" dir="ltr" style={{ fontSize: 13, letterSpacing: 2 }}>{s.id}</span>
            <a className="icon-btn" href="/screen" target="_blank" rel="noreferrer" title={ar ? 'فتح صفحة الشاشة' : 'Open player'}><Icon name="eye" size={16} /></a>
            <button className="icon-btn" onClick={() => setOpenId(openId === s.id ? null : s.id)}><Icon name={openId === s.id ? 'close' : 'edit'} size={16} /></button>
            <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => deleteScreen(s.id)}><Icon name="delete" size={15} /></button>
          </div>
          <div className="xs faint">{(s.items || []).length} {ar ? 'شريحة' : 'slides'}</div>

          {openId === s.id && (
            <>
              <PairPanel screenId={s.id} ar={ar} toast={toast} />

              {/* orientation + ticker + emergency + playlist ops */}
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 10 }}>
                <label className="xs faint">{ar ? 'الاتجاه' : 'Orientation'}</label>
                <select className="select" style={{ maxWidth: 110 }} value={s.orientation || 'landscape'} onChange={(e) => updateScreen(s.id, { orientation: e.target.value }).catch(() => toast.error(t('error')))}>
                  <option value="landscape">{ar ? 'أفقي' : 'Landscape'}</option>
                  <option value="portrait">{ar ? 'عمودي' : 'Portrait'}</option>
                </select>
                <label className="xs faint">{ar ? 'المجموعة' : 'Group'}</label>
                <input className="input input-sm" style={{ maxWidth: 140 }} placeholder={ar ? 'مثال: الصالة' : 'e.g. Hall'} defaultValue={s.group || ''}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== (s.group || '')) updateScreen(s.id, { group: v }).catch(() => toast.error(t('error'))) }} />
                <input className="input input-sm grow" style={{ minWidth: 160 }} placeholder={ar ? 'شريط أخبار متحرك أسفل الشاشة (اختياري)' : 'News ticker (optional)'} defaultValue={s.ticker || ''}
                  onBlur={(e) => { if ((e.target.value || '') !== (s.ticker || '')) updateScreen(s.id, { ticker: e.target.value.trim() }).catch(() => toast.error(t('error'))) }} />
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 10px', background: s.alert?.on ? 'color-mix(in srgb, var(--danger) 12%, transparent)' : 'var(--surface-2)', borderRadius: 10 }}>
                <span className="xs bold" style={{ color: s.alert?.on ? 'var(--danger)' : undefined }}>{ar ? 'رسالة طوارئ (تغطي الشاشة فوراً)' : 'Emergency override'}</span>
                <input className="input input-sm grow" style={{ minWidth: 160 }} placeholder={ar ? 'مثال: نعتذر — تأخير بسيط في الطلبات' : 'e.g. short delay notice'} defaultValue={s.alert?.text || ''}
                  onBlur={(e) => updateScreen(s.id, { alert: { ...(s.alert || {}), text: e.target.value.trim() } }).catch(() => toast.error(t('error')))} />
                <button className={`btn btn-sm ${s.alert?.on ? 'btn-primary' : 'btn-outline'}`} style={s.alert?.on ? { background: 'var(--danger)', borderColor: 'var(--danger)' } : undefined}
                  onClick={() => updateScreen(s.id, { alert: { ...(s.alert || {}), on: !s.alert?.on } }).catch(() => toast.error(t('error')))}>
                  {s.alert?.on ? (ar ? 'إيقاف الطوارئ' : 'Stop') : (ar ? 'تفعيل' : 'Activate')}
                </button>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 10 }}>
                <span className="xs faint">{ar ? 'المحتوى:' : 'Playlist:'}</span>
                {screens.length > 1 && (
                  <select className="select" style={{ maxWidth: 190 }} value="" onChange={(e) => {
                    const target = e.target.value
                    if (!target) return
                    e.target.value = ''
                    if (window.confirm(ar ? 'نسخ محتوى هذه الشاشة إلى الشاشة المختارة (يستبدل محتواها)؟' : 'Copy this playlist over the selected screen?')) {
                      updateScreen(target, { items: s.items || [] }).then(() => toast.success(ar ? 'نُسخ المحتوى' : 'Copied')).catch(() => toast.error(t('error')))
                    }
                  }}>
                    <option value="">{ar ? 'نسخ المحتوى إلى شاشة…' : 'Copy playlist to…'}</option>
                    {screens.filter((x) => x.id !== s.id).map((x) => <option key={x.id} value={x.id}>{x.name || x.id}</option>)}
                  </select>
                )}
                {/* apply this screen's playlist to EVERY screen in the same group */}
                {(s.group || '').trim() && screens.some((x) => x.id !== s.id && (x.group || '').trim() === (s.group || '').trim()) && (
                  <button className="btn btn-sm btn-outline" onClick={() => {
                    const g = (s.group || '').trim()
                    const targets = screens.filter((x) => x.id !== s.id && (x.group || '').trim() === g)
                    const n = (s.items || []).length
                    if (!window.confirm(ar ? `نسخ ${n} شريحة إلى ${targets.length} شاشة في مجموعة «${g}»؟ يستبدل محتواها الحالي.` : `Copy ${n} slides over ${targets.length} screens in group "${g}"?`)) return
                    Promise.all(targets.map((x) => updateScreen(x.id, { items: s.items || [] })))
                      .then(() => toast.success(ar ? `طُبق المحتوى على ${targets.length} شاشة` : `Applied to ${targets.length} screens`))
                      .catch(() => toast.error(t('error')))
                  }}><Icon name="layers" size={13} /> {ar ? 'تطبيق المحتوى على المجموعة' : 'Apply to group'}</button>
                )}
                {/* versions vault: named snapshots (max 5) + legacy single backup */}
                <BackupVault s={s} ar={ar} toast={toast} t={t} />
              </div>
              {/* live remote + transition — the TV obeys instantly via its snapshot */}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 10 }}>
                <button className="btn btn-sm btn-outline" onClick={() => updateScreen(s.id, { paused: !s.paused }).catch(() => toast.error(t('error')))}>
                  <Icon name={s.paused ? 'play' : 'pause'} size={14} /> {s.paused ? (ar ? 'استئناف' : 'Resume') : (ar ? 'إيقاف مؤقت' : 'Pause')}
                </button>
                <button className="btn btn-sm btn-outline" onClick={() => updateScreen(s.id, { control: { cmd: 'next', n: Date.now() } }).catch(() => toast.error(t('error')))}>
                  <Icon name="next" size={14} style={{ transform: 'scaleX(-1)' }} /> {ar ? 'الشريحة التالية' : 'Next slide'}
                </button>
                <button className="btn btn-sm btn-outline" onClick={() => updateScreen(s.id, { control: { cmd: 'reload', n: Date.now() } }).catch(() => toast.error(t('error')))}>
                  <Icon name="reload" size={14} /> {ar ? 'إعادة تحميل' : 'Reload'}
                </button>
                <span className="grow" />
                <label className="xs faint">{ar ? 'الانتقال' : 'Transition'}</label>
                <select className="select" style={{ maxWidth: 120 }} value={s.fx || 'fade'} onChange={(e) => updateScreen(s.id, { fx: e.target.value }).catch(() => toast.error(t('error')))}>
                  <option value="fade">{ar ? 'تلاشي' : 'Fade'}</option>
                  <option value="slide">{ar ? 'انزلاق' : 'Slide'}</option>
                  <option value="zoom">{ar ? 'تقريب' : 'Zoom'}</option>
                </select>
              </div>

              {/* remote MUSIC control — drives the screen's file-playlist player from here.
                  (YouTube playlists play via a plain embed and can't be remote-controlled.) */}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 10 }}>
                <span className="xs faint row" style={{ gap: 4 }}><Icon name="sound" size={13} /> {ar ? 'تحكم الموسيقى (عن بُعد):' : 'Music remote:'}</span>
                <button className="btn btn-sm btn-outline" title={ar ? 'السابق' : 'Previous'} onClick={() => updateScreen(s.id, { control: { cmd: 'music-prev', n: Date.now() } }).catch(() => toast.error(t('error')))}><Icon name="back" size={14} /></button>
                <button className="btn btn-sm btn-outline" onClick={() => updateScreen(s.id, { control: { cmd: 'music-toggle', n: Date.now() } }).catch(() => toast.error(t('error')))}><Icon name="pause" size={14} /> / <Icon name="play" size={14} /></button>
                <button className="btn btn-sm btn-outline" title={ar ? 'التالي' : 'Next'} onClick={() => updateScreen(s.id, { control: { cmd: 'music-next', n: Date.now() } }).catch(() => toast.error(t('error')))}><Icon name="next" size={14} /></button>
                <span className="xs faint">{ar ? '(للأغاني المرفوعة)' : '(uploaded songs)'}</span>
              </div>

              {/* playlist */}
              {(s.items || []).map((sl, i) => (
                <div key={i}>
                <div className="list-row">
                  {sl.type === 'image' && <img src={sl.url} alt="" style={{ width: 56, height: 38, objectFit: 'cover', borderRadius: 6, flex: 'none' }} />}
                  {sl.type === 'video' && <video src={sl.url} muted style={{ width: 56, height: 38, objectFit: 'cover', borderRadius: 6, flex: 'none' }} />}
                  {sl.type === 'menu' && <Icon name="menu" size={22} style={{ color: 'var(--brand)', flex: 'none' }} />}
                  {sl.type === 'prayer' && <Icon name="clock" size={22} style={{ color: 'var(--brand)', flex: 'none' }} />}
                  {sl.type === 'design' && (
                    <div style={{ width: 56, height: 38, borderRadius: 6, overflow: 'hidden', flex: 'none', pointerEvents: 'none', border: '1px solid var(--border)' }}>
                      <DesignSlideView slide={sl} data={liveData} />
                    </div>
                  )}
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="small bold">{sl.type === 'menu' ? (sl.title || (cats.find((c) => c.id === sl.categoryId) ? pickLang(cats.find((c) => c.id === sl.categoryId), 'name', lang) : (ar ? 'الأصناف المميزة' : 'Featured'))) : sl.type === 'prayer' ? (ar ? 'مواقيت الصلاة' : 'Prayer times') : sl.type === 'design' ? (ar ? 'شريحة مصممة' : 'Designed slide') : sl.type === 'video' ? (ar ? 'فيديو' : 'Video') : (ar ? 'صورة' : 'Image')}</div>
                    {sl.type === 'prayer' && (
                      <div className="row xs" style={{ gap: 6, alignItems: 'center', marginTop: 2 }}>
                        <span className="faint">{ar ? 'المدينة:' : 'City:'}</span>
                        <input className="input input-sm" dir="ltr" style={{ maxWidth: 130, height: 26 }} defaultValue={sl.city || 'Riyadh'}
                          onBlur={(e) => { const v = e.target.value.trim() || 'Riyadh'; if (v !== (sl.city || 'Riyadh')) { const it = [...s.items]; it[i] = { ...it[i], city: v }; patchItems(s, it) } }} />
                      </div>
                    )}
                    {sl.type !== 'video' && <div className="xs faint">{sl.duration || 8} {ar ? 'ثانية' : 's'}{sl.type === 'design' ? ` · ${(sl.layers || []).length} ${ar ? 'طبقة' : 'layers'}` : ''}{sl.sched ? ` · ${ar ? 'مجدولة' : 'scheduled'}` : ''}</div>}
                  </div>
                  {sl.type === 'design' && (
                    <button className="icon-btn" title={ar ? 'فتح المصمم' : 'Open designer'} onClick={() => setDesigner({ screenId: s.id, index: i, slide: sl })}><Icon name="palette" size={15} /></button>
                  )}
                  {sl.type === 'design' && (
                    // quick action: insert an order-QR LAYER bound to the venue menu url.
                    // qrKind:'menu' → DesignSlideView's QrLayer resolves menuUrl(venue.slug)
                    // itself, so no url is stored; positioned bottom-corner of the canvas.
                    <button className="icon-btn" title={ar ? 'أضف QR الطلب' : 'Add order QR'} aria-label={ar ? 'أضف QR الطلب' : 'Add order QR'} onClick={() => {
                      if ((sl.layers || []).some((l) => l.type === 'qr' && (l.qrKind || 'menu') === 'menu')) { toast.error(ar ? 'الشريحة تحتوي QR المنيو بالفعل' : 'Slide already has the menu QR'); return }
                      const layer = { id: newLayerId(), type: 'qr', qrKind: 'menu', x: 76, y: 58, w: 19, h: 36, radius: 2 }
                      const it = [...s.items]
                      it[i] = { ...sl, layers: [...(sl.layers || []), layer] }
                      updateScreen(s.id, { items: it }).then(() => toast.success(ar ? 'أُضيف QR الطلب أسفل الشريحة' : 'Order QR added')).catch(() => toast.error(t('error')))
                    }}><Icon name="qr" size={15} /></button>
                  )}
                  <button className="icon-btn" title={ar ? 'جدولة العرض' : 'Schedule'} style={sl.sched ? { color: 'var(--brand)' } : undefined}
                    onClick={() => setSchedFor(schedFor?.screenId === s.id && schedFor.index === i ? null : { screenId: s.id, index: i })}>
                    <Icon name="clock" size={15} />
                  </button>
                  <button className="icon-btn" disabled={i === 0} onClick={() => { const it = [...s.items]; [it[i - 1], it[i]] = [it[i], it[i - 1]]; patchItems(s, it) }}><Icon name="back" size={14} style={{ transform: 'rotate(90deg)' }} /></button>
                  <button className="icon-btn" disabled={i === (s.items || []).length - 1} onClick={() => { const it = [...s.items]; [it[i + 1], it[i]] = [it[i], it[i + 1]]; patchItems(s, it) }}><Icon name="back" size={14} style={{ transform: 'rotate(-90deg)' }} /></button>
                  <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => patchItems(s, s.items.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
                </div>
                {schedFor?.screenId === s.id && schedFor.index === i && (
                  <SlideSched sl={sl} ar={ar}
                    onSave={(sched) => { const it = [...s.items]; it[i] = { ...it[i], sched }; patchItems(s, it); setSchedFor(null) }} />
                )}
                </div>
              ))}
              {/* add slides */}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
                  <Icon name="image" size={14} /> {busy ? t('saving') : (ar ? 'صورة / فيديو' : 'Image / video')}
                  <input type="file" accept="image/*,video/*" style={{ display: 'none' }} disabled={busy} onChange={(e) => onMedia(s, e)} />
                </label>
                <button className="btn btn-sm btn-outline" onClick={() => setMediaLibFor(s.id)}><Icon name="folder" size={14} /> {ar ? 'من المكتبة' : 'Library'}</button>
                <button className="btn btn-sm btn-outline" onClick={() => setDesigner({ screenId: s.id, index: null, slide: newDesignSlide() })}><Icon name="palette" size={14} /> {ar ? 'شريحة تصميم' : 'Design slide'}</button>
                <button className="btn btn-sm btn-outline" onClick={() => setTplFor(s.id)}><Icon name="sparkles" size={14} /> {ar ? 'قوالب جاهزة' : 'Templates'}</button>
                <button className="btn btn-sm btn-outline" onClick={() => addSlide(s, { type: 'menu', categoryId: '', duration: 12 })}><Icon name="menu" size={14} /> {ar ? 'شريحة المميزة' : 'Featured slide'}</button>
                <button className="btn btn-sm btn-outline" title={ar ? 'مواقيت الصلاة لليوم — تُجلب تلقائياً وتُخفى الشريحة إن تعذّر الجلب' : "Today's prayer times (auto-fetched; slide hides on failure)"} onClick={() => addSlide(s, { type: 'prayer', city: 'Riyadh', duration: 12 })}><Icon name="clock" size={14} /> {ar ? 'مواقيت الصلاة' : 'Prayer times'}</button>
                {cats.map((c) => (
                  <button key={c.id} className="btn btn-sm btn-outline" onClick={() => addSlide(s, { type: 'menu', categoryId: c.id, duration: 12 })}>+ {pickLang(c, 'name', lang)}</button>
                ))}
              </div>

              {/* background music: named, schedulable playlists (YouTube + files) with DJ crossfade */}
              <MusicManager screen={s} tenantId={tenantId} busy={busy} setBusy={setBusy} ar={ar} toast={toast} />

            </>
          )}
        </div>
      ))}

      {/* ready-made template gallery — live previews via the shared renderer */}
      <Sheet open={!!tplFor} onClose={() => setTplFor(null)} title={ar ? 'قوالب جاهزة' : 'Templates'}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {templates().map((tp, i) => (
            <button key={i} className="card" style={{ padding: 0, overflow: 'hidden', textAlign: 'start', cursor: 'pointer', border: '1px solid var(--border)' }}
              onClick={() => { setDesigner({ screenId: tplFor, index: null, slide: tp.slide }); setTplFor(null) }}>
              <div style={{ width: '100%', aspectRatio: '16 / 9', pointerEvents: 'none' }}>
                <DesignSlideView slide={tp.slide} data={liveData} />
              </div>
              <div className="small bold" style={{ padding: '8px 10px' }}>{tp.name}</div>
            </button>
          ))}
        </div>
        <p className="xs faint" style={{ marginTop: 10 }}>{ar ? 'اختر قالباً ثم عدّله في المصمم قبل الحفظ — القوالب الحية تسحب العرض النشط والأسعار تلقائياً.' : 'Pick a template, tweak it in the designer, then save — live templates pull the active offer and prices automatically.'}</p>
      </Sheet>

      {designer && (
        <SlideDesigner
          slide={designer.slide}
          tenantId={tenantId}
          lang={lang}
          data={liveData}
          onSave={saveDesign}
          onClose={() => setDesigner(null)}
        />
      )}

      {/* reuse any previously-uploaded image/video from the central library as a slide */}
      {mediaLibFor && (
        <MediaLibrary open tenantId={tenantId} lang={lang} onClose={() => setMediaLibFor(null)}
          onPick={(url, item) => {
            const s = (screens || []).find((x) => x.id === mediaLibFor)
            const isV = item?.kind === 'video'
            if (s && (item?.kind === 'image' || isV)) addSlide(s, { type: isV ? 'video' : 'image', url, duration: isV ? 0 : 8 })
            setMediaLibFor(null)
          }} />
      )}
    </div>
  )
}

// Music manager: named, schedulable playlists (screen.playlists[]). Each holds an
// ordered mix of YouTube links + uploaded songs, a volume + crossfade, and an
// optional schedule (morning / evening…). The player picks the playlist whose
// schedule matches now and plays it with DJ crossfade.
const AUDIO_RE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|wma)$/i
// Fetch a YouTube video's title via oEmbed (no API key, CORS-enabled) so the
// track shows a real name instead of a raw URL.
async function fetchYtTitle(url) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
    if (!r.ok) return ''
    const j = await r.json()
    return (j && j.title) || ''
  } catch (_) { return '' }
}
function MusicManager({ screen: s, tenantId, busy, setBusy, ar, toast }) {
  const [schedOpen, setSchedOpen] = useState(null)
  const pls = s.playlists || []
  const err = () => toast.error(ar ? 'حدث خطأ' : 'Error')
  const save = (playlists) => updateScreen(s.id, { playlists }).catch(err)
  const updP = (pid, patch) => save(pls.map((p) => (p.id === pid ? { ...p, ...patch } : p)))
  const uid = (pfx) => `${pfx}${pls.reduce((n, p) => n + (p.tracks?.length || 0), pls.length)}${(s.id || '').length}`

  const addP = () => {
    const name = window.prompt(ar ? 'اسم قائمة التشغيل (مثلاً: صباحية):' : 'Playlist name (e.g. Morning):')
    if (name === null) return
    save([...pls, { id: `pl${pls.length}${(s.id || '').length}`, name: (name || '').trim() || (ar ? `قائمة ${pls.length + 1}` : `Playlist ${pls.length + 1}`), tracks: [], volume: 0.6, crossfade: 6, sched: null }])
  }
  const delP = (pid) => { if (window.confirm(ar ? 'حذف قائمة التشغيل؟' : 'Delete playlist?')) save(pls.filter((p) => p.id !== pid)) }
  const addYT = async (p) => {
    const url = window.prompt(ar ? 'ألصق رابط يوتيوب:' : 'Paste a YouTube link:')
    if (!url || !url.trim()) return
    const clean = url.trim()
    const title = await fetchYtTitle(clean) // resolve the song name from the link
    updP(p.id, { tracks: [...(p.tracks || []), { id: uid('y'), kind: 'youtube', url: clean, name: title || '' }] })
  }
  const moveT = (p, i, d) => { const t = [...(p.tracks || [])]; const j = i + d; if (j < 0 || j >= t.length) return; [t[i], t[j]] = [t[j], t[i]]; updP(p.id, { tracks: t }) }
  const rmT = (p, i) => updP(p.id, { tracks: (p.tracks || []).filter((_, x) => x !== i) })
  const uploadFiles = async (p, e) => {
    const files = [...(e.target.files || [])].filter((f) => f.type.startsWith('audio/') || AUDIO_RE.test(f.name))
    e.target.value = ''
    if (!files.length || busy) return
    setBusy(true)
    try {
      let added = []
      for (const f of files) {
        const url = await uploadFile(tenantId, f, 'signage')
        added = [...added, { id: `f${added.length}${f.name.length}`, kind: 'file', url, name: f.name.replace(/\.[^.]+$/, '') }]
        // progressive save so tracks appear as they finish
        save(pls.map((x) => (x.id === p.id ? { ...x, tracks: [...(p.tracks || []), ...added] } : x)))
      }
      toast.success(ar ? `أُضيفت ${files.length} أغنية` : `Added ${files.length}`)
    } catch (_) { toast.error(ar ? 'فشل رفع الصوت' : 'Upload failed') } finally { setBusy(false) }
  }

  return (
    <div className="stack" style={{ gap: 10, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 10 }}>
      <div className="row-between">
        <span className="xs faint row" style={{ gap: 4 }}><Icon name="sound" size={13} /> {ar ? 'الموسيقى وقوائم التشغيل' : 'Music & playlists'}</span>
        <button className="btn btn-sm btn-outline" onClick={addP}><Icon name="add" size={13} /> {ar ? 'قائمة جديدة' : 'New playlist'}</button>
      </div>
      {pls.length === 0 && (
        <p className="xs faint" style={{ margin: 0, lineHeight: 1.6 }}>{ar ? 'أنشئ قائمة (صباحية / مسائية…)، أضف روابط يوتيوب أو ارفع أغانٍ أو مجلداً كاملاً — تعمل بتداخل الدي جي وتُجدول لتشتغل في وقتها.' : 'Create a playlist, add YouTube links or upload songs/a whole folder — DJ crossfade + auto-schedule.'}</p>
      )}
      {pls.map((p) => (
        <div key={p.id} className="card card-pad stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <input className="input grow" value={p.name || ''} placeholder={ar ? 'اسم القائمة' : 'Playlist name'} onChange={(e) => updP(p.id, { name: e.target.value })} style={{ minWidth: 0 }} />
            {p.sched && <span className="badge badge-gold" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="clock" size={11} /> {ar ? 'مجدولة' : 'Timed'}</span>}
            <button className="icon-btn" title={ar ? 'جدولة الوقت' : 'Schedule'} style={p.sched ? { color: 'var(--brand)' } : undefined} onClick={() => setSchedOpen(schedOpen === p.id ? null : p.id)}><Icon name="clock" size={15} /></button>
            <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => delP(p.id)}><Icon name="delete" size={15} /></button>
          </div>
          {schedOpen === p.id && <SlideSched sl={p} ar={ar} onSave={(sched) => { updP(p.id, { sched }); setSchedOpen(null) }} />}

          {(p.tracks || []).map((tr, i) => (
            <div key={tr.id || i} className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span className="num xs faint" style={{ width: 16, flex: 'none', textAlign: 'center' }}>{i + 1}</span>
              <Icon name={tr.kind === 'file' ? 'sound' : 'play'} size={13} style={{ color: 'var(--brand)', flex: 'none' }} />
              <span className="small grow" dir={tr.kind === 'file' ? undefined : 'ltr'} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{tr.name || tr.url}</span>
              <button className="icon-btn" disabled={i === 0} onClick={() => moveT(p, i, -1)}><Icon name="back" size={13} style={{ transform: 'rotate(90deg)' }} /></button>
              <button className="icon-btn" disabled={i === (p.tracks.length - 1)} onClick={() => moveT(p, i, 1)}><Icon name="back" size={13} style={{ transform: 'rotate(-90deg)' }} /></button>
              <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => rmT(p, i)}><Icon name="close" size={13} /></button>
            </div>
          ))}

          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-sm btn-outline" onClick={() => addYT(p)}><Icon name="play" size={13} /> {ar ? '+ يوتيوب' : '+ YouTube'}</button>
            <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
              <Icon name="upload" size={13} /> {ar ? 'رفع أغانٍ' : 'Upload songs'}
              <input type="file" accept="audio/*" multiple style={{ display: 'none' }} disabled={busy} onChange={(e) => uploadFiles(p, e)} />
            </label>
            <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
              <Icon name="folder" size={13} /> {ar ? 'رفع مجلد' : 'Upload folder'}
              <input type="file" webkitdirectory="" directory="" multiple style={{ display: 'none' }} disabled={busy} onChange={(e) => uploadFiles(p, e)} />
            </label>
          </div>

          {(p.tracks?.length > 0) && (
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="xs faint">{ar ? 'الصوت' : 'Volume'}</label>
              <input type="range" min="0" max="1" step="0.05" value={p.volume ?? 0.6} onChange={(e) => updP(p.id, { volume: Number(e.target.value) })} style={{ width: 90 }} />
              {p.tracks.length > 1 && (
                <>
                  <label className="xs faint">{ar ? 'التداخل (ث)' : 'Crossfade (s)'}</label>
                  <input type="range" min="2" max="12" step="1" value={p.crossfade ?? 6} onChange={(e) => updP(p.id, { crossfade: Number(e.target.value) })} style={{ width: 90 }} />
                  <span className="xs num">{p.crossfade ?? 6}</span>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// Versions vault (نسخ متعددة): named playlist snapshots in screen.backups =
// [{ name, items, at }] — newest first, max 5 (the oldest is dropped on save).
// The legacy single `backup` field keeps its restore button when present.
const MAX_BACKUPS = 5
function BackupVault({ s, ar, toast, t }) {
  const [naming, setNaming] = useState(false)
  const [vname, setVname] = useState('')
  const list = Array.isArray(s.backups) ? s.backups : []
  const err = () => toast.error(t('error'))
  const fmtAt = (at) => { try { return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(at) } catch (_) { return '' } }
  const saveVersion = () => {
    const nm = vname.trim() || (ar ? `نسخة ${list.length + 1}` : `Version ${list.length + 1}`)
    const next = [{ name: nm, items: s.items || [], at: Date.now() }, ...list].slice(0, MAX_BACKUPS)
    updateScreen(s.id, { backups: next })
      .then(() => { setVname(''); setNaming(false); toast.success(ar ? 'حُفظت النسخة' : 'Version saved') })
      .catch(err)
  }
  return (
    <>
      {naming ? (
        <>
          <input className="input input-sm" style={{ maxWidth: 170 }} autoFocus placeholder={ar ? 'اسم النسخة (رمضان…)' : 'Version name'} value={vname}
            onChange={(e) => setVname(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveVersion() }} />
          <button className="btn btn-sm btn-primary" onClick={saveVersion}><Icon name="check" size={13} /> {ar ? 'حفظ' : 'Save'}</button>
          <button className="btn btn-sm btn-outline" onClick={() => { setNaming(false); setVname('') }}>{ar ? 'إلغاء' : 'Cancel'}</button>
        </>
      ) : (
        <button className="btn btn-sm btn-outline" title={ar ? 'حفظ المحتوى الحالي كنسخة قابلة للاستعادة (بحد أقصى 5)' : 'Save the current playlist as a restorable version (max 5)'} onClick={() => setNaming(true)}>
          <Icon name="copy" size={13} /> {ar ? 'حفظ نسخة باسم…' : 'Save version as…'}
        </button>
      )}
      {/* legacy single-backup restore (screens backed up before the vault) */}
      {Array.isArray(s.backup) && s.backup.length > 0 && (
        <button className="btn btn-sm btn-outline" onClick={() => { if (window.confirm(ar ? 'استبدال المحتوى الحالي بالنسخة الاحتياطية القديمة؟' : 'Restore the legacy backup over current?')) updateScreen(s.id, { items: s.backup }).then(() => toast.success(ar ? 'استُعيدت' : 'Restored')).catch(err) }}>
          <Icon name="reload" size={13} /> {ar ? `استعادة القديمة (${s.backup.length})` : `Restore legacy (${s.backup.length})`}
        </button>
      )}
      {list.length > 0 && (
        <div className="stack" style={{ flexBasis: '100%', gap: 4, marginTop: 2 }}>
          {list.map((b, i) => (
            <div key={`${b.at || 0}-${i}`} className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Icon name="folder" size={13} style={{ color: 'var(--brand)', flex: 'none' }} />
              <span className="small grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name || (ar ? 'نسخة' : 'Version')}</span>
              <span className="xs faint num" style={{ flex: 'none' }}>{(b.items || []).length} {ar ? 'شريحة' : 'slides'}{b.at ? ` · ${fmtAt(b.at)}` : ''}</span>
              <button className="btn btn-sm btn-outline" style={{ flex: 'none' }} onClick={() => { if (window.confirm(ar ? `استبدال المحتوى الحالي بنسخة «${b.name}» (${(b.items || []).length} شريحة)؟` : `Restore "${b.name}" (${(b.items || []).length} slides) over current?`)) updateScreen(s.id, { items: b.items || [] }).then(() => toast.success(ar ? 'استُعيدت' : 'Restored')).catch(err) }}>{ar ? 'استعادة' : 'Restore'}</button>
              <button className="icon-btn" style={{ color: 'var(--danger)', flex: 'none' }} title={ar ? 'حذف النسخة' : 'Delete version'} onClick={() => { if (window.confirm(ar ? `حذف نسخة «${b.name}»؟` : 'Delete this version?')) updateScreen(s.id, { backups: list.filter((_, j) => j !== i) }).catch(err) }}><Icon name="delete" size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// Inline per-slide scheduler: limit a slide to specific weekdays and/or a time
// window (overnight ranges supported). Saved as items[i].sched = { days, start, end }.
function SlideSched({ sl, ar, onSave }) {
  const DAYS = ar ? ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const [days, setDays] = useState(sl.sched?.days || [])
  const [start, setStart] = useState(sl.sched?.start || '')
  const [end, setEnd] = useState(sl.sched?.end || '')
  const toggle = (d) => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]))
  const save = () => {
    const timed = !!(start && end)
    const has = days.length > 0 || timed
    onSave(has ? { days, start: timed ? start : '', end: timed ? end : '' } : null)
  }
  return (
    <div className="stack" style={{ gap: 8, padding: '10px 12px', margin: '4px 0 8px', background: 'var(--surface-2)', borderRadius: 10 }}>
      <strong className="xs">{ar ? 'جدولة الشريحة — تُعرض فقط في:' : 'Slide schedule — show only on:'}</strong>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        {DAYS.map((d, di) => (
          <button key={di} className={`btn btn-sm ${days.includes(di) ? 'btn-primary' : 'btn-outline'}`} style={{ padding: '3px 10px' }} onClick={() => toggle(di)}>{d}</button>
        ))}
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="xs faint">{ar ? 'من' : 'From'}</label>
        <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} style={{ maxWidth: 120 }} />
        <label className="xs faint">{ar ? 'إلى' : 'To'}</label>
        <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={{ maxWidth: 120 }} />
        <span className="grow" />
        <button className="btn btn-sm btn-outline" onClick={() => onSave(null)}>{ar ? 'دائماً (مسح)' : 'Always (clear)'}</button>
        <button className="btn btn-sm btn-primary" onClick={save}>{ar ? 'حفظ' : 'Save'}</button>
      </div>
      <p className="xs faint" style={{ margin: 0 }}>{ar ? 'بلا أيام محددة = كل الأيام؛ بلا وقت = طوال اليوم. يدعم النطاق الليلي (22:00 – 02:00).' : 'No days = every day; no time = all day. Overnight ranges supported.'}</p>
    </div>
  )
}
