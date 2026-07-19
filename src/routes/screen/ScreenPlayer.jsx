import { useEffect, useMemo, useRef, useState } from 'react'
import { watchScreen, watchItems, watchCategories, getTenant, watchReadyBoard, watchOffers, updateScreen } from '../../lib/db.js'
import { pickLang } from '../../lib/i18n.jsx'
import { Price } from '../../components/Riyal.jsx'
import { orderNumber } from '../../lib/format.js'
import DesignSlideView from '../../components/DesignSlideView.jsx'
import Icon from '../../components/Icon.jsx'

// Digital signage player — open /screen on any TV/tablet browser, enter the
// 6-char pairing code from Admin → Screens, and it plays the venue playlist
// (images / videos / live menu slides) fullscreen with realtime updates.
const CODE_KEY = 'ml.screen.code'
const DUR = { image: 8, menu: 12, design: 10, prayer: 12 }

// ---- prayer-times slide (مواقيت الصلاة) helpers ----
// Free keyless API: api.aladhan.com timingsByCity. Data is cached per city in a
// ref + localStorage (6h TTL) and refreshed over the network at most once per
// hour. A city with no VALID cached data (first fetch pending, API down, typo
// city…) makes its slide be SKIPPED entirely — we never show empty/fake times.
const PRAYER_LS = 'ml.screen.prayer'
const PRAYER_KEYS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']
const PRAYER_AR = { Fajr: 'الفجر', Dhuhr: 'الظهر', Asr: 'العصر', Maghrib: 'المغرب', Isha: 'العشاء' }
const normCity = (c) => String(c || '').trim() || 'Riyadh'
const validTimings = (tm) => !!tm && PRAYER_KEYS.every((k) => /^\d{1,2}:\d{2}$/.test(String(tm[k] || '').slice(0, 5).trim()))

// Does a { days:[0-6], start:'HH:MM', end:'HH:MM' } schedule match the current
// wall clock? Empty days = every day; no time = all day; supports overnight wrap
// (22:00–02:00). Shared by slide schedules AND music-playlist schedules.
function schedMatch(sc) {
  if (!sc) return true
  const now = new Date()
  if (Array.isArray(sc.days) && sc.days.length && !sc.days.includes(now.getDay())) return false
  if (sc.start && sc.end) {
    const cur = now.getHours() * 60 + now.getMinutes()
    const [sh, sm] = sc.start.split(':').map(Number)
    const [eh, em] = sc.end.split(':').map(Number)
    const s = sh * 60 + sm, e = eh * 60 + em
    if (s <= e) { if (cur < s || cur > e) return false } else if (cur < s && cur > e) return false
  }
  return true
}

export default function ScreenPlayer() {
  // ?code=XXXX auto-pair: the admin QR / direct link encodes /screen?code=XXXX so
  // opening it pairs instantly (no typing on a TV remote). The param is consumed
  // then stripped from the URL so a later manual unpair sticks across reloads.
  const [code, setCode] = useState(() => {
    try {
      const qp = new URLSearchParams(window.location.search).get('code')
      if (qp && qp.trim().length >= 4) {
        const c = qp.trim().toUpperCase()
        localStorage.setItem(CODE_KEY, c)
        window.history.replaceState(null, '', window.location.pathname)
        return c
      }
    } catch (_) { /* ignore */ }
    return localStorage.getItem(CODE_KEY) || ''
  })
  const [entry, setEntry] = useState('')
  const [screen, setScreen] = useState(undefined)
  const [venue, setVenue] = useState(null)
  const [items, setItems] = useState([])
  const [cats, setCats] = useState([])
  const [idx, setIdx] = useState(0)
  const timer = useRef(null)
  const videoRef = useRef(null)

  // subN bumps on reconnect: a failed onSnapshot listener never restarts itself,
  // so we re-subscribe when the network returns (graceful auto-reconnect).
  const [subN, setSubN] = useState(0)
  useEffect(() => {
    if (!code) { setScreen(undefined); return }
    return watchScreen(code, setScreen)
  }, [code, subN])

  const tid = screen?.tid
  useEffect(() => {
    if (!tid) return
    getTenant(tid).then(setVenue).catch(() => {})
    const u1 = watchItems(tid, setItems)
    const u2 = watchCategories(tid, setCats)
    const u3 = watchReadyBoard(tid, setReadyMap)
    const u4 = watchOffers(tid, setOffers)
    return () => { u1(); u2(); u3(); u4() }
  }, [tid])

  const [readyMap, setReadyMap] = useState({})
  const [offers, setOffers] = useState([])
  const [tick, setTick] = useState(0)
  const [beat, setBeat] = useState(0)

  // wall-clock tick so per-slide schedules (days / time window) re-evaluate
  useEffect(() => { const iv = setInterval(() => setTick((n) => n + 1), 30000); return () => clearInterval(iv) }, [])

  // prayer times per city — ref cache + localStorage (6h), network ≤ once/hour.
  // `prayer[cityKey]` is { times, hijri, at } when verified, or 'fail' — the
  // slides filter below SKIPS prayer slides without valid data (no fake times).
  const [prayer, setPrayer] = useState({})
  const prayerSt = useRef({}) // cityKey → { attemptAt, busy, data }
  useEffect(() => {
    const cities = [...new Set((screen?.items || []).filter((x) => x?.type === 'prayer').map((x) => normCity(x.city)))]
    cities.forEach((city) => {
      const key = city.toLowerCase()
      const st = prayerSt.current[key] || (prayerSt.current[key] = { attemptAt: 0, busy: false, data: null })
      const now = Date.now()
      if (!st.data) {
        try { // survive reloads/offline via localStorage (6h TTL)
          const ls = JSON.parse(localStorage.getItem(`${PRAYER_LS}.${key}`) || 'null')
          if (ls && validTimings(ls.times) && now - ls.at < 6 * 3600 * 1000) { st.data = ls; setPrayer((p) => ({ ...p, [key]: ls })) }
        } catch (_) { /* ignore */ }
      }
      if (st.busy) return
      if (st.data && now - st.data.at < 3600 * 1000) return // fresh (≤1h) — no network
      if (now - st.attemptAt < 3600 * 1000) return // throttle: ≤1 attempt/hour even after failure
      st.attemptAt = now
      st.busy = true
      fetch(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=SA&method=4`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          const tm = j?.data?.timings
          if (validTimings(tm)) {
            const hj = j.data.date?.hijri
            const data = {
              times: Object.fromEntries(PRAYER_KEYS.map((k) => [k, String(tm[k]).slice(0, 5).trim()])),
              hijri: hj ? `${hj.weekday?.ar || ''} ${hj.day} ${hj.month?.ar || ''} ${hj.year}`.replace(/\s+/g, ' ').trim() : '',
              at: Date.now(),
            }
            st.data = data
            try { localStorage.setItem(`${PRAYER_LS}.${key}`, JSON.stringify(data)) } catch (_) { /* ignore */ }
            setPrayer((p) => ({ ...p, [key]: data }))
          } else if (!st.data) setPrayer((p) => ({ ...p, [key]: 'fail' })) // keep any older valid cache
        })
        .catch(() => { if (!st.data) setPrayer((p) => ({ ...p, [key]: 'fail' })) })
        .finally(() => { st.busy = false })
    })
  }, [screen, tick])

  // 1s heartbeat — kiosk/TV browsers throttle an idle page (no input), so a live
  // "order ready" update or its repaint is deferred until the mouse moves. This
  // keeps the event loop warm and re-renders the ready overlay every second so
  // updates land within ~1s WITHOUT any interaction. It does NOT touch `slides`,
  // so slide timers are never reset.
  useEffect(() => { const iv = setInterval(() => setBeat((n) => n + 1), 1000); return () => clearInterval(iv) }, [])

  // Keep the slideshow VIDEO playing. Starting background music (a YouTube player)
  // can make some TV browsers pause the muted slideshow video (media focus) — it
  // then looks like the video "disappeared". Re-assert playback each heartbeat;
  // the video is muted so replay is always permitted.
  useEffect(() => {
    const v = videoRef.current
    if (v && !paused && v.paused && v.readyState >= 2) v.play().catch(() => {})
  }) // eslint-disable-line

  // keep the display awake + the page active (re-acquire when it becomes visible)
  useEffect(() => {
    let lock = null
    let alive = true
    const acquire = async () => {
      try {
        if (!navigator.wakeLock || document.visibilityState !== 'visible') return
        const l = await navigator.wakeLock.request('screen')
        if (alive) lock = l; else l.release?.().catch(() => {}) // unmounted mid-request
      } catch (_) { /* unsupported/denied — the heartbeat still covers updates */ }
    }
    const onVis = () => { if (document.visibilityState === 'visible') acquire() }
    acquire()
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis); lock?.release?.().catch(() => {}) }
  }, [])

  // remote control commands from the admin (screens/{code}.control = {cmd, n})
  const lastCmd = useRef(0)
  const ctrlN = screen?.control?.n || 0
  useEffect(() => {
    if (!ctrlN || ctrlN === lastCmd.current) return
    const first = lastCmd.current === 0
    lastCmd.current = ctrlN
    if (first) return // ignore the stale command present at mount
    const cmd = screen?.control?.cmd
    if (cmd === 'next') setIdx((i) => i + 1)
    if (cmd === 'reload') window.location.reload()
    if (cmd === 'unpair') { localStorage.removeItem(CODE_KEY); setCode(''); setEntry('') }
  }, [ctrlN]) // eslint-disable-line

  // kiosk fullscreen: auto-request on the FIRST user gesture (browsers require
  // one), plus a visible toggle button that appears on activity and hides after
  // 5s of inactivity so the signage stays clean.
  const [fsBtn, setFsBtn] = useState(false)
  const [isFs, setIsFs] = useState(false)
  const fsTried = useRef(false)
  const fsHideT = useRef(null)
  const toggleFs = () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen?.()
      else document.documentElement.requestFullscreen?.()
    } catch (_) { /* unsupported (e.g. iPhone Safari) — page still plays fine */ }
  }
  useEffect(() => {
    const onAct = () => {
      setFsBtn(true)
      clearTimeout(fsHideT.current)
      fsHideT.current = setTimeout(() => setFsBtn(false), 5000)
      // first gesture → try to enter kiosk fullscreen automatically
      if (!fsTried.current) {
        fsTried.current = true
        if (!document.fullscreenElement) { try { document.documentElement.requestFullscreen?.()?.catch?.(() => {}) } catch (_) { /* ignore */ } }
      }
    }
    const onFs = () => setIsFs(!!document.fullscreenElement)
    window.addEventListener('pointerdown', onAct)
    document.addEventListener('fullscreenchange', onFs)
    return () => { window.removeEventListener('pointerdown', onAct); document.removeEventListener('fullscreenchange', onFs); clearTimeout(fsHideT.current) }
  }, [])

  // health heartbeat every 75s: the admin sees «متصل الآن / آخر اتصال» + which
  // slide is playing. Anonymous TVs may write ONLY these two fields (rules-gated).
  const idxRef = useRef(0)
  useEffect(() => { idxRef.current = idx }, [idx])
  useEffect(() => {
    if (!code || !screen) return undefined
    const send = () => updateScreen(code, { lastSeenAt: Date.now(), nowIdx: idxRef.current }).catch(() => {})
    send()
    const iv = setInterval(send, 75000)
    return () => clearInterval(iv)
  }, [code, !!screen]) // eslint-disable-line react-hooks/exhaustive-deps

  // graceful offline notice — Firestore keeps the last snapshot in memory so the
  // playlist keeps looping; we just tell the room and auto-clear on reconnect.
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  useEffect(() => {
    const on = () => { setOnline(true); setSubN((n) => n + 1) } // re-subscribe on reconnect
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  const paused = !!screen?.paused
  // depends on `beat` too: recompute every second so a newly-ready order paints
  // within ~1s on an idle screen (and old ones age out) without interaction.
  const readyList = useMemo(() =>
    Object.entries(readyMap || {})
      .filter(([, v]) => v && v.at > Date.now() - 30 * 60 * 1000)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 4),
  [readyMap, beat])

  const slides = useMemo(() => (screen?.items || []).filter((s) => {
    if (!schedMatch(s.sched)) return false
    if (s.type === 'prayer') { // only with verified fetched times — otherwise the slide is skipped entirely
      const d = prayer[normCity(s.city).toLowerCase()]
      return !!d && d !== 'fail' && validTimings(d.times)
    }
    return s.type === 'menu' || s.type === 'design' || !!s.url
  }), [screen, tick, prayer]) // eslint-disable-line

  // pick the active music playlist by schedule (e.g. morning / evening); a
  // scheduled playlist that matches now wins, else an unscheduled default, else
  // the first. Legacy single `screen.audio` is used when no playlists exist.
  const activePlaylist = useMemo(() => {
    const pls = (screen?.playlists || []).filter((p) => p && (p.tracks?.length))
    if (!pls.length) return screen?.audio || null
    return pls.find((p) => p.sched && schedMatch(p.sched)) || pls.find((p) => !p.sched) || pls[0]
  }, [screen, tick]) // eslint-disable-line
  const slide = slides.length ? slides[idx % slides.length] : null
  const fx = `scr-fx-${['slide', 'zoom'].includes(screen?.fx) ? screen.fx : 'fade'}`
  // per-screen design fields (set from Admin → Screens → التصميم) — all optional
  const fit = screen?.fit === 'contain' ? 'contain' : 'cover' // media letterbox vs fill
  const scrBg = screen?.bg || '' // canvas color behind letterboxed media
  // brand override: recolors live menu slides + design-slide bindings without
  // touching the venue profile (venue stays the fallback).
  const venueEff = useMemo(() => (screen?.brand && venue ? { ...venue, brandColor: screen.brand, themeColor: screen.brand } : venue), [venue, screen?.brand])

  // advance: images/menu by duration, videos on ended — frozen while paused
  useEffect(() => {
    clearTimeout(timer.current)
    if (!slide || slides.length < 2 || paused) return
    if (slide.type !== 'video') {
      const secs = Number(slide.duration) || DUR[slide.type] || 8
      timer.current = setTimeout(() => setIdx((i) => i + 1), secs * 1000)
    }
    return () => clearTimeout(timer.current)
  }, [slide, slides.length, idx, paused])

  useEffect(() => { setIdx(0) }, [slides.length])

  const pair = () => {
    const c = entry.trim().toUpperCase()
    if (c.length < 4) return
    localStorage.setItem(CODE_KEY, c)
    setCode(c)
  }
  const unpair = () => { localStorage.removeItem(CODE_KEY); setCode(''); setEntry('') }

  // ---- pairing screen ----
  if (!code || screen === null) {
    return (
      <div className="scr-root scr-center">
        <div className="scr-pair">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
          <h2 style={{ margin: 0 }}>ربط شاشة العرض</h2>
          {screen === null && code ? (
            !online
              ? <p className="scr-err">لا يوجد اتصال بالإنترنت — سيُعاد الاتصال والربط تلقائياً عند عودة الشبكة</p>
              : <p className="scr-err">الرمز «{code}» غير موجود — أنشئ الشاشة من لوحة الإدارة ← الشاشات</p>
          ) : <p style={{ opacity: 0.75, margin: 0 }}>أدخل رمز الشاشة من: لوحة الإدارة ← الشاشات، أو امسح رمز QR من بطاقة الربط</p>}
          <input className="scr-input" dir="ltr" maxLength={8} placeholder="ABC123" value={entry}
            onChange={(e) => setEntry(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') pair() }} autoFocus />
          <button className="scr-btn" onClick={pair}>ربط الشاشة</button>
          {code && <button className="scr-btn scr-btn-ghost" onClick={unpair}>مسح الرمز</button>}
        </div>
      </div>
    )
  }

  if (screen === undefined) return <div className="scr-root scr-center"><div className="spinner" /></div>

  // ---- empty playlist ----
  if (!slide) {
    return (
      <div className="scr-root scr-center">
        <div className="scr-pair">
          {venue?.logoUrl && <img src={venue.logoUrl} alt="" style={{ width: 110, height: 110, borderRadius: '50%', objectFit: 'cover' }} />}
          <h2 style={{ margin: 0 }}>{venue?.name || ''}</h2>
          <p style={{ opacity: 0.7, margin: 0 }}>أضف محتوى لهذه الشاشة من: لوحة الإدارة ← الشاشات ({code})</p>
          <button className="scr-btn scr-btn-ghost" onClick={unpair}>فك الربط</button>
        </div>
      </div>
    )
  }

  // ---- player ----
  return (
    <div className="scr-root" data-orient={screen?.orientation === 'portrait' ? 'portrait' : undefined} onDoubleClick={unpair} title="نقرة مزدوجة لفك الربط" style={scrBg ? { background: scrBg } : undefined}>
      {/* emergency override: instant fullscreen message on every paired screen */}
      {screen?.alert?.on && screen.alert.text ? (
        <div className="scr-alert">{screen.alert.text}</div>
      ) : null}
      {/* news ticker strip (hidden while an alert is up) */}
      {screen?.ticker && !(screen?.alert?.on && screen.alert.text) ? (
        <div className="scr-ticker" aria-hidden="true"><span>{screen.ticker}</span><span>{screen.ticker}</span></div>
      ) : null}
      {slide.type === 'video' ? (
        <video ref={videoRef} key={`${idx}-${slide.url}`} className={`scr-media ${fx}`} src={slide.url} autoPlay muted playsInline style={{ objectFit: fit }}
          onEnded={() => (!paused && slides.length > 1 ? setIdx((i) => i + 1) : null)} loop={slides.length === 1 || paused} />
      ) : slide.type === 'image' ? (
        <img key={`${idx}-${slide.url}`} className={`scr-media ${fx}`} src={slide.url} alt="" style={{ objectFit: fit }} />
      ) : slide.type === 'design' ? (
        <div key={idx} className={`scr-media ${fx}`}>
          <DesignSlideView slide={slide} data={{ items, offers, venue: venueEff }} />
        </div>
      ) : (
        <MenuSlide key={idx} slide={slide} venue={venueEff} items={items} cats={cats} fxClass={fx} />
      )}
      {/* paused-by-remote indicator */}
      {paused && (
        <div style={{ position: 'absolute', bottom: 22, insetInlineStart: 26, display: 'flex', alignItems: 'center', gap: 9, background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(8px)', padding: '8px 16px', borderRadius: 999, color: '#fff', fontWeight: 700, fontSize: 14 }}>
          <span style={{ display: 'inline-flex', gap: 3 }}>
            <span style={{ width: 4, height: 14, background: '#fff', borderRadius: 2 }} />
            <span style={{ width: 4, height: 14, background: '#fff', borderRadius: 2 }} />
          </span>
          إيقاف مؤقت من الإدارة
        </div>
      )}
      {/* venue badge (can be hidden per screen from the design tab) */}
      {!screen?.hideBadge && (
        <div className="scr-badge">
          {venue?.logoUrl && <img src={venue.logoUrl} alt="" />}
          <strong>{venue?.name || ''}</strong>
        </div>
      )}
      {/* kiosk fullscreen toggle — appears on activity, hides after 5s idle */}
      {fsBtn && (
        <button className="scr-fsbtn" onClick={toggleFs} title={isFs ? 'الخروج من ملء الشاشة' : 'ملء الشاشة'}>
          {isFs ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" /></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
          )}
          <span>{isFs ? 'خروج' : 'ملء الشاشة'}</span>
        </button>
      )}
      {/* offline notice — playback continues from the last snapshot */}
      {!online && (
        <div className="scr-offline">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" /></svg>
          انقطع الاتصال — العرض مستمر وسيُعاد الاتصال تلقائياً
        </div>
      )}
      {/* live "order ready" overlay — floats above any content */}
      {readyList.length > 0 && (
        <div className="scr-ready">
          <div className="scr-ready-head" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
            طلبك جاهز
          </div>
          <div className="scr-ready-codes">
            {readyList.map(([id, v], i) => (
              <span key={id} className={`scr-ready-code num ${i === 0 ? 'newest' : ''}`}>{orderNumber(v.code)}</span>
            ))}
          </div>
        </div>
      )}
      {/* background music: schedule-selected playlist. YouTube → simple embed
          (TV-compatible); files → crossfade engine. Controlled from Admin → Screens. */}
      <SignageMusic playlist={activePlaylist} command={screen?.control} />
    </div>
  )
}

// Load the YouTube IFrame Player API once (needed for volume control + crossfade).
let ytApiPromise = null
function loadYT() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT)
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT) }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(s)
  })
  return ytApiPromise
}

// Extract a YouTube video id from a full link, short link, embed, shorts, or raw id.
function ytVideoId(url) {
  const s = String(url || '').trim()
  if (/^[\w-]{11}$/.test(s)) return s
  const m = s.match(/(?:youtu\.be\/|[?&]v=|embed\/|shorts\/)([\w-]{11})/)
  return m ? m[1] : ''
}

// Normalize a playlist (or legacy single audio) into a clean track list.
function normTracks(pl) {
  if (!pl) return []
  if (pl.tracks && pl.tracks.length) {
    return pl.tracks.filter((t) => t && t.url).map((t, i) => ({ id: t.id || `t${i}`, kind: t.kind === 'file' ? 'file' : 'youtube', url: t.url, name: t.name || '' }))
  }
  if (pl.url) return [{ id: 'single', kind: pl.kind === 'file' ? 'file' : 'youtube', url: pl.url, name: pl.name || '' }]
  return []
}

// Router: a YouTube playlist uses a plain hidden embed (maximally compatible —
// works on limited Smart-TV browsers too; this is exactly what worked before the
// IFrame-API rewrite). File playlists use the <audio> DJ engine (crossfade +
// controls, well-supported everywhere).
function SignageMusic({ playlist, command }) {
  const tracks = normTracks(playlist)
  if (!tracks.length) return null
  const ytIds = tracks.filter((t) => t.kind === 'youtube').map((t) => ytVideoId(t.url)).filter(Boolean)
  if (ytIds.length) return <SignageYouTubeEmbed ids={ytIds} name={playlist?.name} command={command} />
  return <SignageFileDJ playlist={playlist} command={command} />
}

// Shared on-screen music control bar (tap the screen to reveal; auto-hides).
function MusicControlBar({ name, playing, onPrev, onToggle, onNext, onSeek, onKeep }) {
  const cbtn = { background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 4 }
  return (
    <div onPointerDown={onKeep}
      style={{ position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)', zIndex: 25, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'rgba(0,0,0,.62)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 20, padding: '8px 16px', color: '#fff', maxWidth: '86vw' }}>
      {name && <span style={{ fontSize: 12.5, fontWeight: 700, opacity: 0.92, maxWidth: '80vw', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button style={cbtn} title="السابق" onClick={onPrev}><Icon name="back" size={22} /></button>
        {onSeek && <button style={{ ...cbtn, fontSize: 12, fontWeight: 800 }} title="تأخير 10 ثوانٍ" onClick={() => onSeek(-10)}>−10</button>}
        <button style={cbtn} onClick={onToggle}><Icon name={playing ? 'pause' : 'play'} size={26} /></button>
        {onSeek && <button style={{ ...cbtn, fontSize: 12, fontWeight: 800 }} title="تقديم 10 ثوانٍ" onClick={() => onSeek(10)}>+10</button>}
        <button style={cbtn} title="التالي" onClick={onNext}><Icon name="next" size={22} /></button>
      </div>
    </div>
  )
}

const ArmButton = ({ onClick, label }) => (
  <button onClick={onClick}
    style={{ position: 'absolute', bottom: 22, insetInlineEnd: 26, zIndex: 20, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(8px)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', borderRadius: 999, padding: '10px 18px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
    {label}
  </button>
)

// YouTube background player: a full-viewport hidden embed (behind the slides) so
// the TV browser keeps it active. Controlled via postMessage (enablejsapi=1) —
// lighter than the full IFrame API, so play/pause/next/prev can work even on TV
// browsers. Both the on-screen bar AND the admin remote drive the same commands.
function SignageYouTubeEmbed({ ids, name, command }) {
  const [armed, setArmed] = useState(false)
  const [playing, setPlaying] = useState(true)
  const [show, setShow] = useState(false)
  const ref = useRef(null)
  const hideT = useRef(null)
  const playingRef = useRef(true)

  const post = (func, args = []) => {
    try { if (ref.current && ref.current.contentWindow) ref.current.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*') } catch (_) { /* ignore */ }
  }
  const setPlay = (v) => { playingRef.current = v; setPlaying(v) }
  const toggle = () => { post(playingRef.current ? 'pauseVideo' : 'playVideo'); setPlay(!playingRef.current) }
  const next = () => { post('nextVideo'); setPlay(true) }
  const prev = () => { post('previousVideo'); setPlay(true) }

  // remote control from Admin → Screens
  const lastCmd = useRef(0)
  useEffect(() => {
    const n = command?.n || 0
    if (!n || n === lastCmd.current) return
    const first = lastCmd.current === 0; lastCmd.current = n
    if (first || !command?.cmd || !command.cmd.startsWith('music-')) return
    if (command.cmd === 'music-toggle') toggle()
    else if (command.cmd === 'music-next') next()
    else if (command.cmd === 'music-prev') prev()
  }, [command?.n]) // eslint-disable-line

  // keep-alive watchdog: TV browsers throttle background media and a network
  // blip can leave the player buffer-stalled forever. Re-asserting playVideo
  // every 10s is a no-op while playing and a resume when stalled/paused-by-OS.
  useEffect(() => {
    if (!armed) return undefined
    const iv = setInterval(() => { if (playingRef.current) post('playVideo') }, 10000)
    return () => clearInterval(iv)
  }, [armed]) // eslint-disable-line react-hooks/exhaustive-deps
  // reveal the on-screen bar on any tap
  useEffect(() => {
    if (!armed) return
    const onTap = () => { setShow(true); clearTimeout(hideT.current); hideT.current = setTimeout(() => setShow(false), 5000) }
    window.addEventListener('pointerdown', onTap)
    return () => { window.removeEventListener('pointerdown', onTap); clearTimeout(hideT.current) }
  }, [armed])

  if (!ids || !ids.length) return null
  const src = `https://www.youtube.com/embed/${ids[0]}?autoplay=1&loop=1&playlist=${ids.length > 1 ? ids.join(',') : ids[0]}&controls=0&playsinline=1&modestbranding=1&rel=0&iv_load_policy=3&enablejsapi=1`
  const keep = (e) => { e.stopPropagation(); setShow(true); clearTimeout(hideT.current); hideT.current = setTimeout(() => setShow(false), 5000) }
  return (
    <>
      {armed && (
        // SMALL on purpose: YouTube picks stream quality from the PLAYER SIZE —
        // a full-viewport hidden iframe decoded 1080p video for audio-only use
        // and stuttered weak TV boxes. 320x180 → tiny stream, smooth audio.
        // Kept in-viewport at near-zero opacity (display:none / off-screen gets
        // media-throttled by some TV browsers and the audio stops).
        <iframe ref={ref} key={ids.join(',')} title="bg-music" allow="autoplay; encrypted-media" tabIndex={-1}
          style={{ position: 'absolute', bottom: 0, insetInlineStart: 0, width: 320, height: 180, border: 0, pointerEvents: 'none', zIndex: -1, opacity: 0.01 }}
          src={src} />
      )}
      {!armed && <ArmButton onClick={() => setArmed(true)} label={name ? `${name} · تشغيل الموسيقى` : 'تشغيل الموسيقى'} />}
      {armed && show && <MusicControlBar name={name} playing={playing} onPrev={prev} onToggle={toggle} onNext={next} onKeep={keep} />}
    </>
  )
}

// <audio>-based DJ engine for uploaded-file playlists: seamless crossfade + on-
// screen controls (play/pause, prev/next, seek ±10s). Files play everywhere.
function SignageFileDJ({ playlist, command }) {
  const tracksRef = useRef(normTracks(playlist))
  const initial = normTracks(playlist)
  const plId = playlist?.id || (initial[0]?.url || '')

  const [armed, setArmed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ i: 0, n: initial.length, name: initial[0]?.name || '' })
  const hostRef = useRef(null)
  const auA = useRef(null)
  const auB = useRef(null)
  const st = useRef(null)
  const hideT = useRef(null)

  const target = Math.min(1, Math.max(0, playlist && playlist.volume != null ? playlist.volume : 0.6))
  const crossfade = Math.min(12, Math.max(2, (playlist && playlist.crossfade) || 6))

  useEffect(() => () => {
    const s = st.current
    if (s) { clearInterval(s.mon); clearInterval(s.fade); s.decks.forEach((d) => d.destroy()) }
    st.current = null
  }, [])

  // keep the live track list fresh (reorder/add applies on the next transition)
  useEffect(() => { tracksRef.current = normTracks(playlist) }, [playlist])
  // live volume slider reaches the active deck
  useEffect(() => { const s = st.current; if (s) { s.target = target; if (!s.fading) s.decks[s.active].setVol(target) } }, [target])
  // the schedule swapped to a different playlist → crossfade into its first track
  useEffect(() => { const s = st.current; if (s && s.switchTo) { s.idx = 0; s.switchTo(0) } }, [plId]) // eslint-disable-line
  // REMOTE control from Admin → Screens (screen.control = { cmd:'music-*', n })
  const lastMusicCmd = useRef(0)
  useEffect(() => {
    const n = command?.n || 0
    if (!n || n === lastMusicCmd.current) return
    const first = lastMusicCmd.current === 0
    lastMusicCmd.current = n
    const s = st.current
    if (first || !s || !command?.cmd?.startsWith('music-')) return
    if (command.cmd === 'music-toggle') s.toggle?.()
    else if (command.cmd === 'music-next') s.next?.()
    else if (command.cmd === 'music-prev') s.prev?.()
  }, [command?.n]) // eslint-disable-line
  // reveal the on-screen bar on any tap
  useEffect(() => {
    if (!armed) return
    const onTap = () => { setShow(true); clearTimeout(hideT.current); hideT.current = setTimeout(() => setShow(false), 5000) }
    window.addEventListener('pointerdown', onTap)
    return () => { window.removeEventListener('pointerdown', onTap); clearTimeout(hideT.current) }
  }, [armed])

  if (!initial.length) return null

  const begin = async () => {
    if (st.current) return
    setArmed(true)
    const list0 = tracksRef.current
    const YT = list0.some((t) => t.kind === 'youtube') ? await loadYT() : null
    const host = hostRef.current
    const list = () => (tracksRef.current.length ? tracksRef.current : list0)

    const makeDeck = (n) => {
      let mode = null
      let ytp = null
      let ytReady = false
      let queue = [] // YT ops requested before the player fired onReady — replayed in order
      const au = n === 0 ? auA.current : auB.current
      const ytDo = (fn) => { if (!ytp) return; if (ytReady) { try { fn() } catch (_) { /* ignore */ } } else queue.push(fn) }
      if (YT && host) {
        const div = document.createElement('div'); div.id = `dj-${n}`; host.appendChild(div)
        ytp = new YT.Player(`dj-${n}`, {
          playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, playsinline: 1, rel: 0, modestbranding: 1 },
          events: {
            onReady: () => { ytReady = true; const q = queue; queue = []; q.forEach((fn) => { try { fn() } catch (_) { /* ignore */ } }) },
            onStateChange: (e) => { if (e.data === YT.PlayerState.ENDED) { const s = st.current; if (s && s.active === n && mode === 'yt' && !s.fading) s.onEnd() } },
          },
        })
      }
      if (au) au.onended = () => { const s = st.current; if (s && s.active === n && mode === 'file' && !s.fading) s.onEnd() }
      const clamp = (v) => Math.max(0, Math.min(1, v))
      return {
        load(tr) {
          if (tr.kind === 'youtube' && ytp) { mode = 'yt'; try { au && au.pause() } catch (_) { /* ignore */ } ytDo(() => ytp.loadVideoById(ytVideoId(tr.url))) }
          else if (au) { mode = 'file'; ytDo(() => ytp.stopVideo()); try { au.src = tr.url; au.load() } catch (_) { /* ignore */ } }
        },
        play() { if (mode === 'yt') ytDo(() => ytp.playVideo()); else if (au) au.play().catch(() => {}) },
        pause() { if (mode === 'yt') ytDo(() => ytp.pauseVideo()); else if (au) au.pause() },
        stop() { if (mode === 'yt') ytDo(() => ytp.stopVideo()); else if (au) au.pause() },
        setVol(v) { if (mode === 'yt') ytDo(() => ytp.setVolume(Math.round(clamp(v) * 100))); else if (au) au.volume = clamp(v) },
        cur() { try { return (mode === 'yt' ? (ytReady ? ytp.getCurrentTime() : 0) : au.currentTime) || 0 } catch (_) { return 0 } },
        dur() { try { return (mode === 'yt' ? (ytReady ? ytp.getDuration() : 0) : au.duration) || 0 } catch (_) { return 0 } },
        seek(t) { if (mode === 'yt') ytDo(() => ytp.seekTo(Math.max(0, t), true)); else if (au) au.currentTime = Math.max(0, t) },
        destroy() { try { ytp && ytp.destroy() } catch (_) { /* ignore */ } },
      }
    }

    const s = { decks: [makeDeck(0), makeDeck(1)], idx: 0, active: 0, fading: false, paused: false, mon: null, fade: null, target }
    st.current = s
    const L = () => list().length
    const nextIdx = () => (L() > 1 ? (s.idx + 1) % L() : s.idx)
    const prevIdx = () => (L() > 1 ? (s.idx - 1 + L()) % L() : s.idx)

    const crossfadeTo = (ni) => {
      if (s.fading) return
      const t = list()[ni]; if (!t) return
      s.fading = true
      const cur = s.active, other = s.active ^ 1
      s.decks[other].load(t); s.decks[other].setVol(0); s.decks[other].play()
      setPos({ i: ni, n: L(), name: (list()[ni] || {}).name || '' })
      const steps = 24, stepT = (crossfade * 1000) / steps
      let k = 0
      s.fade = setInterval(() => {
        k++; const f = k / steps
        s.decks[cur].setVol(s.target * (1 - f))
        s.decks[other].setVol(s.target * f)
        if (k >= steps) { clearInterval(s.fade); s.fade = null; s.decks[cur].stop(); s.active = other; s.idx = ni; s.fading = false }
      }, stepT)
    }
    const jump = (ni) => {
      const t = list()[ni]; if (!t) return
      if (s.fading) { clearInterval(s.fade); s.fade = null; s.fading = false }
      const other = s.active ^ 1
      s.decks[other].load(t); s.decks[other].setVol(s.target); s.decks[other].play()
      s.decks[s.active].stop(); s.active = other; s.idx = ni; setPos({ i: ni, n: L() })
    }
    s.onEnd = () => { if (!s.paused) crossfadeTo(nextIdx()) }
    s.switchTo = (ni) => crossfadeTo(ni) // schedule swapped playlists
    s.next = () => { s.paused = false; setPlaying(true); crossfadeTo(nextIdx()) }
    s.prev = () => { s.paused = false; setPlaying(true); jump(prevIdx()) }
    s.seek = (d) => s.decks[s.active].seek(s.decks[s.active].cur() + d)
    s.toggle = () => {
      if (s.paused) { s.paused = false; s.decks[s.active].play(); if (s.fading) s.decks[s.active ^ 1].play(); setPlaying(true) }
      else { s.paused = true; s.decks[s.active].pause(); if (s.fading) s.decks[s.active ^ 1].pause(); setPlaying(false) }
    }

    // start deck 0 — YT ops queue until the player is ready (no fragile timeout),
    // file decks play immediately since the tap already granted audio permission
    s.startTs = Date.now()
    s.decks[0].load(list()[0]); s.decks[0].setVol(s.target); s.decks[0].play(); setPlaying(true); setPos({ i: 0, n: L(), name: (list()[0] || {}).name || '' })
    s.mon = setInterval(() => {
      if (!st.current || s.fading || s.paused) return
      const d = s.decks[s.active], dur = d.dur(), cur = d.cur()
      if (dur && dur > crossfade + 3 && dur - cur <= crossfade) crossfadeTo(nextIdx())
    }, 500)
  }

  const keep = (e) => { e.stopPropagation(); setShow(true); clearTimeout(hideT.current); hideT.current = setTimeout(() => setShow(false), 5000) }
  return (
    <>
      <div ref={hostRef} style={{ position: 'absolute', width: 1, height: 1, left: -9999, top: -9999, opacity: 0, pointerEvents: 'none', overflow: 'hidden' }} />
      <audio ref={auA} />
      <audio ref={auB} />
      {!armed && <ArmButton onClick={begin} label={playlist?.name ? `${playlist.name} · تشغيل الموسيقى` : 'تشغيل الموسيقى'} />}
      {armed && show && (
        <MusicControlBar
          name={pos.name || playlist?.name || ''}
          playing={playing}
          onPrev={() => st.current && st.current.prev()}
          onToggle={() => st.current && st.current.toggle()}
          onNext={() => st.current && st.current.next()}
          onSeek={(d) => st.current && st.current.seek(d)}
          onKeep={keep}
        />
      )}
    </>
  )
}

// Live menu slide: a category (or featured) rendered big for TV — prices update in realtime.
const priceVal = (it) => {
  const b = Number(it.price) || 0
  if (b) return b
  const vs = (it.variants || []).map((v) => Number(v.price) || 0).filter((x) => x > 0)
  return vs.length ? Math.min(...vs) : 0
}

function MenuSlide({ slide, venue, items, cats, fxClass = '' }) {
  const list = items
    .filter((i) => i.available !== false && (slide.categoryId ? i.categoryId === slide.categoryId : i.featured || i.imageUrl))
    .slice(0, 8)
  const cat = cats.find((c) => c.id === slide.categoryId)
  const brand = venue?.brandColor || venue?.themeColor || '#7c2d2d'
  // 5 items on the default 4-column grid leaves a lone orphan card on the second
  // row — route 5 through the 3-column layout (3+2) instead. 7 stays on 4 columns
  // (4+3), which is already balanced.
  const gridN = list.length === 5 ? 6 : list.length
  return (
    <div className={`scr-menu ${fxClass}`} style={{ '--scr-brand': brand }}>
      <h2 className="scr-menu-title">{slide.title || (cat ? pickLang(cat, 'name', 'ar') : 'أصنافنا المميزة')}</h2>
      <div className="scr-menu-grid" data-n={gridN}>
        {list.map((it) => (
          <div key={it.id} className="scr-item">
            {it.imageUrl ? <img src={it.imageUrl} alt="" loading="lazy" /> : <div className="scr-item-ph" />}
            <div className="scr-item-body">
              <strong>{it.nameAr}</strong>
              <span className="scr-price"><Price value={priceVal(it)} currency={venue?.currency || 'SAR'} lang="ar" /></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
