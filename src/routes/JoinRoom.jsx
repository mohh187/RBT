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
import CoverPlate from '../components/games/CoverPlate.jsx'
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
import { applyVenueFavicon, applyVenueManifest, restorePlatformManifest } from '../lib/pwa.js'
import '../styles/room.css'

const MAX_NAME = 24

// Mirror the invite-link registration into the games hub's per-device store.
// The hub gates on `store.registered` read from `rbt_games_<tid>` — NOT from
// `ml.customer`, which is all this page used to write. Without this seed an
// invited guest who registered right here is asked for their name and phone
// AGAIN the first time they open any game, and the venue's tournament cards
// stay hidden from them. One write, so a single registration counts everywhere.
//
// The key string and the fields (`registered`, `name`, `phone`, `promoSeen`)
// MUST stay identical to src/components/GamesCenter.jsx (`storeKey` / the
// `EMPTY_STORE` shape / what its own gate writes in `submitGate`). The hub only
// ever READS this store, so writing it from here can never fight the hub. We
// merge onto whatever is already there so a returning guest keeps their best
// scores, points and resume state. `tid` here is the tenant DOCUMENT id from
// the /join/:tid route — the very id MenuView resolves the slug to — so both
// sides address the same `rbt_games_<id>` key.
const gamesStoreKey = (tid) => `rbt_games_${tid || 'x'}`
function seedGamesRegistration(tid, { name, phone }) {
  try {
    const key = gamesStoreKey(tid)
    let prev = {}
    try { prev = JSON.parse(localStorage.getItem(key) || '{}') || {} } catch (_) { prev = {} }
    if (prev.registered && prev.name) return // already known here; don't stomp
    const next = { ...prev, registered: true, name, phone: phone || '', promoSeen: true }
    localStorage.setItem(key, JSON.stringify(next))
  } catch (_) { /* storage off — the guest still plays, worst case re-registers once */ }
}

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

  // The host by name turns a bare link into a personal invitation.
  const hostName = useMemo(() => {
    const h = (room?.players || []).find((p) => p.id === room?.hostId)
    return String(h?.name || '').trim()
  }, [room])

  // The game's cover accent (games.js cover spec: [deep, mid, hi, extra?])
  // electrifies the page's majlis palette — room.css reads these variables.
  const covPal = Array.isArray(game?.cover?.palette) ? game.cover.palette : []
  const rootStyle = {
    '--rm-acc': covPal[1] || undefined,
    '--rm-acc-hi': covPal[2] || undefined,
  }

  // ---- venue ----
  useEffect(() => {
    let alive = true
    if (!tid) { setFatal('لم نتعرّف على المكان في هذا الرابط.'); setLoading(false); return undefined }
    getTenant(tid)
      .then((tn) => { if (alive) setTenant(tn) })
      .catch(() => { /* the room still works without venue branding */ })
    return () => { alive = false }
  }, [tid])

  // ---- the venue's identity on the most-shared surface ----
  // An invite link is the page a guest is most likely to install or bookmark.
  // It used to keep the PLATFORM identity (RBT 360 favicon/manifest/title) even
  // though the same venue's /m/:slug swaps all of it, and its dark majlis
  // palette sat under a near-white theme-color, so the phone's browser chrome
  // showed a white band over a black page.
  useEffect(() => {
    if (!tenant) return undefined
    const prevTitle = document.title
    document.title = tenant.name || prevTitle
    applyVenueFavicon(tenant, slug)
    if (slug) applyVenueManifest(tenant, slug)
    return () => { document.title = prevTitle; restorePlatformManifest() }
  }, [tenant, slug])

  // The room's dark palette is painted on an inner fixed layer, so <body> stayed
  // near-white and themeColor.js mirrored THAT — a white browser-chrome band and
  // a white overscroll flash above a black page. Tinting body while this page is
  // mounted fixes both; the class change is what themeColor.js watches, so the
  // meta re-syncs on its own.
  useEffect(() => {
    document.body.classList.add('rm-body')
    return () => document.body.classList.remove('rm-body')
  }, [])

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
      // ...and into the games hub's own store, so the hub's gate never re-asks.
      seedGamesRegistration(tid, { name: nm, phone })
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
  const maxSeats = room.maxPlayers || MAX_SEATS
  return (
    <div className="rm-root rm-page" style={rootStyle}>
      <div className="rm-scroll">
        <div className="rm-wrap">
          {/* the invitation, framed as one: the game's own cover leads, the
              host calls you by name, the venue signs it */}
          <div className="rm-hero rm-hero-join rm-fade">
            <CoverPlate game={game} className="rm-hero-art" />
            <span className="rm-hero-scrim" aria-hidden="true" />
            <div className="rm-hero-body">
              <p className="rm-invite-line">
                <Icon name="sparkles" size={13} />
                {hostName ? `${hostName} يدعوك للعب` : 'دعوة للعب على الطاولة'}
              </p>
              <h1 className="rm-title">{game ? game.ar : 'غرفة لعب'}</h1>
              <div className="rm-hero-chips">
                {tenant?.name ? (
                  <span className="rm-chip">
                    {tenant?.logoUrl
                      ? <img className="rm-chip-logo" src={tenant.logoUrl} alt="" />
                      : <Icon name="store" size={12} />}
                    {tenant.name}
                  </span>
                ) : null}
                {room?.tableLabel ? (
                  <span className="rm-chip">
                    <Icon name="tables" size={12} />
                    {`طاولة ${room.tableLabel}`}
                  </span>
                ) : null}
                <span className="rm-chip rm-chip-gold">
                  <span className="rm-dot rm-dot-live" aria-hidden="true" />
                  <span className="rm-chip-num">{`${players.length}/${maxSeats}`}</span>
                </span>
              </div>
            </div>
          </div>

          {players.length ? (
            <div className="rm-card rm-fade">
              <div className="rm-card-h">
                <span className="rm-card-ico"><Icon name="customers" size={15} /></span>
                في الغرفة الآن
                <span className="rm-count">{`${players.length}/${maxSeats}`}</span>
              </div>
              <ul className="rm-pl-chips">
                {players.map((p) => {
                  const live = isConnected(p, now)
                  return (
                    <li className="rm-pl-chip" key={p.id}>
                      <span className="rm-avatar">{(p.name || '?').trim().charAt(0) || '?'}</span>
                      <span className="rm-pl-name">{p.name}</span>
                      {room.hostId === p.id ? (
                        <span className="rm-crown" role="img" aria-label="المضيف" title="المضيف">
                          <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true" focusable="false">
                            <path d="M3 19h18v2H3zM2.6 17 4.4 7.6l4.7 4.2L12 4l2.9 7.8 4.7-4.2L21.4 17z" />
                          </svg>
                        </span>
                      ) : null}
                      <span className={`rm-dot${live ? ' rm-dot-live' : ' rm-dot-off'}`} aria-hidden="true" />
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

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
              <label className="rm-label" htmlFor="rm-phone">
                رقم الجوال <em>(اختياري)</em>
              </label>
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

          <div className="rm-what rm-fade">
            <span className="rm-what-h">
              <Icon name="sparkles" size={13} />
              ماذا سيحدث؟
            </span>
            <p className="rm-note">
              تدخل الغرفة فوراً باسمك ويراك أصحابك في المقاعد، وتبدأ الجولة حين يبدأها المضيف — بلا تطبيق وبلا حساب.
            </p>
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
