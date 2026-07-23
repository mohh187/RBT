// ===========================================================================
// GAMES JOIN PANEL — the idle invitation the wall shows between boards.
//
// Its whole job is to convert someone walking past into a player, using ONLY
// the join paths that already exist:
//
//   1. the venue's own public menu QR (lib/qr.js → menuUrl) — the same code
//      already printed on the tables — which opens «ركن الألعاب»;
//   2. the six-character ROOM CODE that lib/gameRoom.js already mints and that
//      RoomLobby already accepts in its «انضم برمز» field.
//
// Nothing new is invented and nothing new has to be configured.
//
// PRIVACY — WHEN A ROOM CODE MAY GO ON THE WALL. A room code is a key: anyone
// who reads it can take a seat. A family waiting for their fourth player must
// not be gate-crashed by the whole cafe, so codes are NOT broadcast by default.
// The caller passes `invites` only while the venue has a RUNNING TOURNAMENT —
// the venue-level switch that already means "we are running an open competition
// tonight" (see lib/spectate.js, SAFETY LIMIT 3). Room documents carry no phone
// (gameRoom.normalizePlayer), and lib/spectate.openRoomInvites trims what is
// passed here down to a code, a game, a seat count and a first name.
// ===========================================================================
import { useEffect, useState } from 'react'
import { fmtNum } from '../../lib/socialPlay.js'
import { spectateGameName } from '../../lib/spectate.js'
import { BrandBar } from '../../components/screen/LiveMatchScreen.jsx'
import './screen-games.css'

// One QR per URL for the life of the page. The playlist rotates back to this
// panel every couple of minutes and re-encoding a 512px QR each time is pure
// waste on a weak TV box.
const qrCache = new Map()

function useQr(url) {
  const [src, setSrc] = useState(() => qrCache.get(url) || '')
  useEffect(() => {
    if (!url) { setSrc(''); return undefined }
    const hit = qrCache.get(url)
    if (hit) { setSrc(hit); return undefined }
    let alive = true
    import('../../lib/qr.js')
      .then(({ qrDataUrl }) => qrDataUrl(url, { width: 512, dark: '#1b2a26', light: '#fffdf7' }))
      .then((d) => { qrCache.set(url, d); if (alive) setSrc(d) })
      .catch(() => { /* a screen with no QR still shows the steps and the codes */ })
    return () => { alive = false }
  }, [url])
  return src
}

const GAME_AR = {
  ludo: 'الليدو', chess: 'الشطرنج', dominoes: 'الدومينو',
  wist: 'الوِست', jackaroo: 'الجكارو', haree: 'الحريق',
}
const gameLabel = (id) => GAME_AR[id] || spectateGameName(id) || 'لعبة'

// ---------------------------------------------------------------------------
// GamesJoinPanel
//   venue     tenant document (name, logo, slug, brand)
//   title     headline — the tournament's name while one is running
//   note      one supporting line (the prize, or what the games are)
//   invites   open-room invitations from lib/spectate.openRoomInvites, or []
//   live      draw the LIVE pill (true only while a tournament is running)
// ---------------------------------------------------------------------------
export default function GamesJoinPanel({
  venue = null,
  title = '',
  note = '',
  invites = [],
  live = false,
  className = '',
}) {
  const brand = venue?.brandColor || venue?.themeColor || '#0e7490'
  const slug = String(venue?.slug || '')
  // Built lazily so a venue with no slug simply gets no QR panel rather than a
  // QR that leads nowhere.
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!slug) { setUrl(''); return undefined }
    let alive = true
    import('../../lib/qr.js')
      .then(({ menuUrl }) => { if (alive) setUrl(menuUrl(slug)) })
      .catch(() => {})
    return () => { alive = false }
  }, [slug])
  const qr = useQr(url)

  const codes = (Array.isArray(invites) ? invites : []).slice(0, 3)

  return (
    <div className={`tvg-root${className ? ' ' + className : ''}`} style={{ '--tvg-brand': brand }}>
      <BrandBar
        venue={venue}
        context={live ? 'بطولة جارية' : 'ركن الألعاب'}
        live={live}
        liveLabel="مباشر"
      />

      <div className="tvg-join" data-solo={qr ? '0' : '1'}>
        <div className="tvg-join-copy">
          <h2 className="tvg-join-t">{title || 'العب الآن من جوالك'}</h2>
          {note ? <p className="tvg-join-p">{note}</p> : null}

          <div className="tvg-steps">
            <div className="tvg-step">
              <i aria-hidden="true">1</i>
              <span>امسح الرمز، أو افتح قائمة المكان من رمز طاولتك</span>
            </div>
            <div className="tvg-step">
              <i aria-hidden="true">2</i>
              <span>اختر «ركن الألعاب»</span>
            </div>
            <div className="tvg-step">
              <i aria-hidden="true">3</i>
              <span>
                {codes.length
                  ? 'ابدأ غرفة جديدة، أو أدخل أحد الرموز التالية للانضمام'
                  : 'ابدأ غرفة جديدة وشارك رمزها مع من معك'}
              </span>
            </div>
          </div>

          {codes.length ? (
            <div className="tvg-codes">
              {codes.map((r) => (
                <div key={r.roomId} className="tvg-code">
                  <b dir="ltr">{r.roomId}</b>
                  <span>
                    {gameLabel(r.gameId)}
                    {' · '}
                    <span className="tvg-num">{fmtNum(r.free)}</span>
                    {' مقعد شاغر'}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {qr ? (
          <div className="tvg-qr">
            <img src={qr} alt="" />
            <span className="tvg-qr-cap">امسح للعب</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
