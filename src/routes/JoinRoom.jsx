// ===========================================================================
// JoinRoom — route /join/:tid/:roomId
//
// The page an invited guest lands on from a shared link. They arrive with no
// app, no account and no context: this page has to answer "where am I, what am
// I joining, and what do I do" in one screen, then get out of the way.
//
// Registering the guest is deliberate, not a dark pattern: the venue's CRM is
// how a diner gets their loyalty progress and their receipts, so a friend who
// joins a game becomes a known guest exactly like one who orders. The phone is
// OPTIONAL — refusing it still lets you play, because holding a game hostage
// for a phone number would be extortion, not onboarding.
//
// Every failure has a way forward. There is no dead end on this page:
//   not found  → join by another code, or open the venue's menu
//   ended      → open the menu (where the games hub can start a fresh room)
//   full       → same, with the honest reason
//   started    → same
// ===========================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { getTenant, registerCustomer } from '../lib/db.js'
import { getLocalCustomer, setLocalCustomer } from '../lib/customer.js'
import { deviceKey } from '../lib/device.js'
import {
  watchRoom,
  joinRoom,
  heartbeat,
  roomErrorText,
  isConnected,
  HEARTBEAT_MS,
  MAX_SEATS,
} from '../lib/gameRoom.js'
import { gameById } from '../lib/games.js'
import '../styles/room.css'

const MAX_NAME = 24

export default function JoinRoom() {
  const { tid, roomId } = useParams()
  const [sp] = useSearchParams()
  const navigate = useNavigate()

  const slugHint = sp.get('v') || ''
  const tableToken = sp.get('t') || ''
  const myId = useMemo(() => deviceKey(), [])
  const saved = useMemo(() => getLocalCustomer() || {}, [])

  const [tenant, setTenant] = useState(null)
  const [room, setRoom] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fatal, setFatal] = useState('')
  const [name, setName] = useState(saved.name || '')
  const [phone, setPhone] = useState(saved.phone || '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [seated, setSeated] = useState(false)

  const game = room?.gameId ? gameById(room.gameId) : null
  const slug = tenant?.slug || slugHint
  const menuHref = slug ? `/m/${slug}` : '/'

  // ---- venue ----
  useEffect(() => {
    let alive = true
    if (!tid) { setFatal('لم نتعرّف على المكان في هذا الرابط.'); setLoading(false); return undefined }
    getTenant(tid)
      .then((tn) => { if (alive) setTenant(tn) })
      .catch(() => { /* the room still works without venue branding */ })
    return () => { alive = false }
  }, [tid])

  // ---- the live room ----
  useEffect(() => {
    if (!tid || !roomId) return undefined
    const off = watchRoom(tid, roomId, (r, e) => {
      setLoading(false)
      if (e) { setFatal(roomErrorText(e)); setRoom(null); return }
      setFatal('')
      setRoom(r)
    })
    return off
  }, [tid, roomId])

  // ---- once seated, keep presence alive on this page too ----
  useEffect(() => {
    if (!seated || !tid || !roomId) return undefined
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') heartbeat({ tid, roomId, playerId: myId })
    }, HEARTBEAT_MS)
    return () => clearInterval(iv)
  }, [seated, tid, roomId, myId])

  // ---- hand off to the venue's menu, which owns the games hub ----
  // The room + game ride in the query string so the hub can reopen this exact
  // board. The lead wires the pickup; this page only points at it.
  // An unknown slug is a reason to WAIT, not to guess. `menuHref` falls back to
  // '/', which on the platform host is the marketing landing page — so handing
  // off before the tenant resolved would drop an invited guest onto marketing
  // with the room and game silently dropped from the URL. Refusing here leaves
  // them on the "seat saved" screen, which is honest and has a way forward.
  // When the invite carried the host's table token, hand off to the TABLE route
  // rather than the plain menu, so the guest who joined the game at that table
  // can also order to it. MenuView reads the room/game params either way.
  const handOff = useCallback(() => {
    if (!slug) return
    const q = new URLSearchParams({ room: roomId, game: room?.gameId || '' })
    const base = tableToken ? `/t/${slug}/${encodeURIComponent(tableToken)}` : `/m/${slug}`
    navigate(`${base}?${q.toString()}`, { replace: true })
  }, [navigate, slug, tableToken, roomId, room?.gameId])

  // A player already seated (a refresh, a re-opened link) skips the form
  // entirely — their seat was never lost, so asking again would be a lie.
  useEffect(() => {
    if (!room || seated) return
    const mine = (room.players || []).some((p) => p.id === myId)
    if (mine) setSeated(true)
  }, [room, seated, myId])

  // ...and goes straight to the board. This page exists to get someone INTO a
  // game; once the seat is confirmed there is nothing left to decide, so making
  // them tap "enter" would be a speed bump, not a choice. Guarded by a ref so a
  // room update cannot re-navigate, and skipped for an ended room, which would
  // hand them a dead board instead of the honest "الجولة انتهت" screen below.
  const wentRef = useRef(false)
  useEffect(() => {
    if (!seated || wentRef.current || !room || room.status === 'ended' || !slug) return
    wentRef.current = true
    handOff()
  }, [seated, room, slug, handOff])

  const doJoin = useCallback(async () => {
    const nm = String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
    if (!nm) { setErr('اكتب اسمك ليعرفك من على الطاولة.'); return }
    setBusy(true); setErr('')
    try {
      const { seat } = await joinRoom({ tid, roomId, player: { id: myId, name: nm, phone } })
      setLocalCustomer({ name: nm, phone })
      // CRM registration is best-effort and never blocks getting into the game.
      if (phone) registerCustomer(tid, { name: nm, phone }).catch(() => {})
      heartbeat({ tid, roomId, playerId: myId })
      if (seat >= 0) { setSeated(true); handOff() }
    } catch (e) {
      setErr(roomErrorText(e))
    } finally {
      setBusy(false)
    }
  }, [name, phone, tid, roomId, myId, handOff])

  // ===================== shells =====================
  const venueStrip = (
    <div className="rm-venue">
      {tenant?.logoUrl
        ? <img className="rm-venue-logo" src={tenant.logoUrl} alt="" />
        : <span className="rm-venue-logo" />}
      <span className="rm-venue-body">
        <span className="rm-venue-name">{tenant?.name || 'RBT360'}</span>
        <span className="rm-venue-meta">
          {game ? game.ar : 'غرفة لعب'}
          {room?.tableLabel ? ` · طاولة ${room.tableLabel}` : ''}
        </span>
      </span>
    </div>
  )

  const deadEndEscape = (
    <>
      <a className="rm-btn rm-btn-primary rm-press" href={menuHref}>
        <Icon name="menu" size={17} />
        افتح قائمة المكان
      </a>
      <p className="rm-note" style={{ textAlign: 'center' }}>
        تبدأ غرفة جديدة من «ركن الألعاب» داخل القائمة.
      </p>
    </>
  )

  const problem = (title, body) => (
    <div className="rm-root rm-page">
      <div className="rm-scroll">
        <div className="rm-wrap">
          {venueStrip}
          <div className="rm-card rm-fade">
            <div className="rm-err">
              <span className="rm-err-icon"><Icon name="warning" size={24} /></span>
              <span className="rm-err-title">{title}</span>
              <span className="rm-err-body">{body}</span>
            </div>
            {deadEndEscape}
          </div>
        </div>
      </div>
    </div>
  )

  // ===================== states =====================
  if (loading) {
    return (
      <div className="rm-root rm-page">
        <div className="rm-scroll">
          <div className="rm-wrap">
            <div className="rm-wait">
              <span className="rm-spin" aria-hidden="true" />
              نفتح الغرفة…
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (fatal || !room) {
    return problem('لم نجد هذه الغرفة', fatal || 'ربما انتهت الجولة أو الرابط غير صحيح.')
  }

  if (room.status === 'ended' && !seated) {
    return problem('انتهت هذه الجولة', 'وصل الرابط بعد أن أُغلقت الغرفة. ابدأ جولة جديدة من قائمة المكان.')
  }

  const players = room.players || []
  const mine = players.some((p) => p.id === myId)
  const full = players.length >= (room.maxPlayers || MAX_SEATS)

  if (!mine && full) {
    return problem('الغرفة مكتملة', `اكتملت المقاعد الأربعة في هذه الغرفة. اطلب من أصدقائك غرفة جديدة، أو ابدأ واحدة بنفسك.`)
  }

  if (!mine && room.status === 'playing') {
    return problem('بدأت الجولة', 'انطلقت اللعبة قبل أن تفتح الرابط. انتظر الجولة القادمة أو ابدأ غرفة جديدة.')
  }

  // Already seated: no form, just a way back into the board.
  if (mine || seated) {
    return (
      <div className="rm-root rm-page">
        <div className="rm-scroll">
          <div className="rm-wrap">
            {venueStrip}
            <div className="rm-card rm-fade">
              <div className="rm-card-h">
                <Icon name="check" size={16} />
                مقعدك محفوظ
              </div>
              <p className="rm-note">أنت داخل الغرفة بالفعل. تابع اللعب من هنا.</p>
              <button type="button" className="rm-btn rm-btn-primary rm-press" onClick={handOff}>
                <Icon name="play" size={17} />
                ادخل الغرفة
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---------- the join form ----------
  const now = Date.now()
  return (
    <div className="rm-root rm-page">
      <div className="rm-scroll">
        <div className="rm-wrap">
          {venueStrip}

          <div className="rm-card rm-fade">
            <div className="rm-card-h">
              <Icon name="customers" size={16} />
              {`في الغرفة الآن (${players.length}/${room.maxPlayers || MAX_SEATS})`}
            </div>
            <ul className="rm-seats">
              {players.map((p) => {
                const live = isConnected(p, now)
                return (
                  <li className="rm-seat" key={p.id}>
                    <span className="rm-avatar">{(p.name || '?').trim().charAt(0) || '?'}</span>
                    <span className="rm-seat-body">
                      <span className="rm-seat-name">{p.name}</span>
                      <span className="rm-seat-meta">{live ? 'متصل' : 'انقطع مؤقتاً — مقعده محفوظ'}</span>
                    </span>
                    {room.hostId === p.id ? <span className="rm-badge">المضيف</span> : null}
                    <span className={`rm-dot${live ? ' rm-dot-live' : ' rm-dot-off'}`} aria-hidden="true" />
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="rm-card rm-fade">
            <div className="rm-field">
              <label className="rm-label" htmlFor="rm-name">اسمك</label>
              <input
                id="rm-name"
                className="rm-input"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, MAX_NAME))}
                placeholder="كيف يناديك من على الطاولة"
                autoComplete="given-name"
                enterKeyHint="done"
              />
            </div>
            <div className="rm-field">
              <label className="rm-label" htmlFor="rm-phone">رقم الجوال (اختياري)</label>
              <input
                id="rm-phone"
                className="rm-input rm-input-ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, '').slice(0, 20))}
                placeholder="05xxxxxxxx"
                inputMode="tel"
                autoComplete="tel"
                enterKeyHint="done"
              />
              <p className="rm-note">
                نضيفك لعملاء المكان حتى تصلك عروضه ونقاط ولائك. اتركه فارغاً وستلعب كما أنت.
              </p>
            </div>
            {err ? <p className="rm-form-err">{err}</p> : null}
          </div>
        </div>
      </div>

      <div className="rm-foot">
        <div className="rm-wrap">
          <button
            type="button"
            className="rm-btn rm-btn-primary rm-press"
            onClick={doJoin}
            disabled={busy || !name.trim()}
          >
            {busy ? <span className="rm-spin" aria-hidden="true" /> : <Icon name="play" size={17} />}
            {busy ? 'ندخلك الغرفة…' : 'انضم للعب'}
          </button>
          <a className="rm-btn rm-btn-ghost rm-press" href={menuHref}>
            تصفّح القائمة بدل اللعب
          </a>
        </div>
      </div>
    </div>
  )
}
