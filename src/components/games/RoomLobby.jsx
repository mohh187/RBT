// ===========================================================================
// RoomLobby — how four phones at one table end up on the same board.
//
// Two paths, both one tap, because a guest holding a phone at a table will not
// read instructions:
//   «العب مع من على الطاولة»  live list of open rooms on this table → join
//   «ادعُ صديقاً»              create a room → invite link, share sheet, and the
//                              six-character code to read out loud
//
// The lobby owns NO game logic. It creates the room, seats people, and calls
// onStart(roomId) the moment the room turns 'playing' — for the host that is
// their own tap, for everyone else it is the snapshot arriving. Both go through
// the same code path, so there is no way for the host to be on a board the
// others are not.
//
// The game's own module is loaded here for exactly two reasons: to read
// RULES_AR (so the how-to-play is never out of sync with the code that
// implements it) and to call initialState(playerCount) at START time — the
// first moment the real seat count is known.
// ===========================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { deviceKey } from '../../lib/device.js'
import {
  createRoom,
  joinRoom,
  watchRoom,
  roomsForTable,
  heartbeat,
  leaveRoom,
  startGame,
  inviteUrl,
  isConnected,
  roomErrorText,
  normalizeRoomCode,
  HEARTBEAT_MS,
  MAX_SEATS,
} from '../../lib/gameRoom.js'
import '../../styles/room.css'

const T = {
  lobby: { ar: 'غرفة اللعب', en: 'Game room' },
  withTable: { ar: 'العب مع من على الطاولة', en: 'Play with the table' },
  invite: { ar: 'ادعُ صديقاً', en: 'Invite a friend' },
  openRooms: { ar: 'غرف مفتوحة على طاولتك', en: 'Open rooms at your table' },
  noOpen: { ar: 'لا توجد غرفة مفتوحة على هذه الطاولة الآن. ابدأ واحدة وادعُ من معك.', en: 'No open room here yet.' },
  noTable: { ar: 'لم نتعرّف على طاولتك، فلا نستطيع عرض غرف الطاولة. الدعوة بالرابط تعمل دائماً.', en: 'Table unknown — invite by link instead.' },
  creating: { ar: 'نجهّز الغرفة…', en: 'Creating the room…' },
  joining: { ar: 'ندخلك الغرفة…', en: 'Joining…' },
  code: { ar: 'رمز الغرفة', en: 'Room code' },
  codeHint: { ar: 'اقرأ الرمز على من معك، أو أرسل الرابط.', en: 'Read the code aloud, or send the link.' },
  copy: { ar: 'نسخ الرابط', en: 'Copy link' },
  copied: { ar: 'تم النسخ', en: 'Copied' },
  share: { ar: 'مشاركة الرابط', en: 'Share link' },
  seats: { ar: 'المقاعد', en: 'Seats' },
  host: { ar: 'المضيف', en: 'Host' },
  you: { ar: 'أنت', en: 'You' },
  empty: { ar: 'مقعد شاغر', en: 'Empty seat' },
  away: { ar: 'انقطع مؤقتاً — مقعده محفوظ', en: 'Away — seat kept' },
  live: { ar: 'متصل', en: 'Live' },
  start: { ar: 'ابدأ الجولة', en: 'Start' },
  waitHost: { ar: 'بانتظار المضيف ليبدأ الجولة', en: 'Waiting for the host' },
  playing: { ar: 'جارية', en: 'Playing' },
  waiting: { ar: 'بانتظار لاعبين', en: 'Waiting' },
  leave: { ar: 'خروج من الغرفة', en: 'Leave' },
  back: { ar: 'رجوع', en: 'Back' },
  byCode: { ar: 'انضم برمز', en: 'Join by code' },
  codePh: { ar: 'رمز من ستة أحرف', en: 'Six-character code' },
  go: { ar: 'دخول', en: 'Join' },
  rules: { ar: 'كيف نلعب', en: 'How to play' },
  retry: { ar: 'أعد المحاولة', en: 'Try again' },
}

// Arabic ordinals for the honest waiting line («بانتظار لاعب ثالث…»).
const ORDINAL_AR = ['', 'أول', 'ثاني', 'ثالث', 'رابع']

export default function RoomLobby({
  tid,
  tenant = null,
  game = null,
  table = null,
  player = null,
  lang = 'ar',
  onStart,
  onExit,
}) {
  const ar = lang !== 'en'
  const t = useCallback((k) => (ar ? T[k].ar : T[k].en), [ar])

  // A stable identity for this phone. The device key is what makes a rejoin
  // land on the same seat after a refresh, so it must not be regenerated.
  const me = useMemo(() => ({
    id: player?.id || deviceKey(),
    name: player?.name || '',
    phone: player?.phone || '',
  }), [player?.id, player?.name, player?.phone])

  const [roomId, setRoomId] = useState('')
  const [room, setRoom] = useState(null)
  const [mySeat, setMySeat] = useState(-1)
  const [openRooms, setOpenRooms] = useState([])
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [rules, setRules] = useState('')
  const [showRules, setShowRules] = useState(false)

  const startedRef = useRef(false)
  const modRef = useRef(null)

  const maxPlayers = Math.max(2, Math.min(MAX_SEATS, Number(game?.maxPlayers) || 2))
  const minPlayers = Math.max(2, Math.min(maxPlayers, Number(game?.minPlayers) || 2))
  const gameName = ar ? (game?.ar || '') : (game?.en || game?.ar || '')

  // ---- load the game module once, for RULES_AR and initialState() ----
  useEffect(() => {
    let alive = true
    if (typeof game?.load !== 'function') return undefined
    game.load().then((m) => {
      if (!alive) return
      modRef.current = m
      if (typeof m?.RULES_AR === 'string') setRules(m.RULES_AR)
    }).catch(() => { /* rules are a nicety; play does not depend on them */ })
    return () => { alive = false }
  }, [game])

  // ---- open rooms on this table ----
  useEffect(() => {
    if (!tid || !table?.id || roomId) return undefined
    const off = roomsForTable(tid, table.id, (rows) => {
      setOpenRooms((rows || []).filter((r) => r.gameId === game?.id))
    })
    return off
  }, [tid, table?.id, game?.id, roomId])

  // ---- the live room ----
  useEffect(() => {
    if (!tid || !roomId) return undefined
    const off = watchRoom(tid, roomId, (r, e) => {
      if (e) { setErr(roomErrorText(e)); return }
      setRoom(r)
      setErr('')
      const seat = (r?.players || []).find((p) => p.id === me.id)?.seat
      if (seat !== undefined) setMySeat(seat)
    })
    return off
  }, [tid, roomId, me.id])

  // ---- hand off the moment the room is playing (host and guests alike) ----
  useEffect(() => {
    if (room?.status === 'playing' && !startedRef.current && roomId) {
      startedRef.current = true
      onStart?.(roomId)
    }
  }, [room?.status, roomId, onStart])

  // ---- presence ----
  useEffect(() => {
    if (!tid || !roomId) return undefined
    heartbeat({ tid, roomId, playerId: me.id })
    const iv = setInterval(() => {
      // A backgrounded tab should not claim to be present.
      if (document.visibilityState === 'visible') heartbeat({ tid, roomId, playerId: me.id })
    }, HEARTBEAT_MS)
    const onVis = () => { if (document.visibilityState === 'visible') heartbeat({ tid, roomId, playerId: me.id }) }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis) }
  }, [tid, roomId, me.id])

  // ---- actions ----
  const doCreate = useCallback(async () => {
    if (busy) return
    setBusy('create'); setErr('')
    try {
      const id = await createRoom({
        tid,
        gameId: game?.id,
        table,
        player: me,
        maxPlayers,
        minPlayers,
        initialState: {},
        turnMs: Number(game?.turnMs) || 0,
      })
      setRoomId(id)
      setMySeat(0)
    } catch (e) {
      setErr(roomErrorText(e))
    } finally {
      setBusy('')
    }
  }, [busy, tid, game, table, me, maxPlayers, minPlayers])

  const doJoin = useCallback(async (id) => {
    if (busy || !id) return
    setBusy('join'); setErr('')
    try {
      const { seat } = await joinRoom({ tid, roomId: id, player: me })
      setMySeat(seat)
      setRoomId(id)
    } catch (e) {
      setErr(roomErrorText(e))
    } finally {
      setBusy('')
    }
  }, [busy, tid, me])

  const doStart = useCallback(async () => {
    if (busy || !room) return
    setBusy('start'); setErr('')
    try {
      // The seat count is only final now, so this is where initialState is built.
      let st
      try {
        const mod = modRef.current || (typeof game?.load === 'function' ? await game.load() : null)
        modRef.current = mod
        st = typeof mod?.initialState === 'function' ? mod.initialState(room.players?.length || minPlayers) : {}
      } catch (_) {
        st = {}
      }
      await startGame({
        tid,
        roomId,
        playerId: me.id,
        initialState: st,
        turnMs: Number(game?.turnMs) || 0,
      })
      // No onStart here on purpose: the snapshot drives the hand-off for
      // everyone, host included, so nobody can be a frame ahead of the board.
    } catch (e) {
      setErr(roomErrorText(e))
    } finally {
      setBusy('')
    }
  }, [busy, room, tid, roomId, me.id, game, minPlayers])

  const doLeave = useCallback(async () => {
    if (roomId) await leaveRoom({ tid, roomId, playerId: me.id })
    setRoomId(''); setRoom(null); setMySeat(-1); startedRef.current = false
  }, [tid, roomId, me.id])

  const link = roomId ? inviteUrl(tid, roomId, tenant?.slug) : ''

  const doCopy = useCallback(async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
    } catch (_) {
      // Clipboard is blocked outside a secure context / older iOS: fall back to
      // a selection the guest can copy by hand rather than silently doing nothing.
      const ta = document.createElement('textarea')
      ta.value = link
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch (_) { /* nothing more we can do */ }
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }, [link])

  const doShare = useCallback(async () => {
    if (!link) return
    const title = gameName ? `${gameName} — ${tenant?.name || ''}`.trim() : (tenant?.name || 'RBT360')
    if (navigator.share) {
      try {
        await navigator.share({ title, text: ar ? 'العب معي الآن' : 'Play with me', url: link })
        return
      } catch (_) { /* the guest dismissed the sheet — not an error */ }
    }
    doCopy()
  }, [link, gameName, tenant?.name, ar, doCopy])

  // ---- derived ----
  const players = room?.players || []
  const seated = players.length
  const canStart = room?.status === 'lobby' && seated >= minPlayers && room?.hostId === me.id
  const iAmHost = room?.hostId === me.id
  const now = Date.now()

  const waitingLine = useMemo(() => {
    if (!room || room.status !== 'lobby') return ''
    if (seated >= minPlayers) {
      return iAmHost ? '' : t('waitHost')
    }
    const need = seated + 1
    if (!ar) return `Waiting for player ${need}…`
    return `بانتظار لاعب ${ORDINAL_AR[need] || ''}…`.replace(/\s+/g, ' ')
  }, [room, seated, minPlayers, iAmHost, ar, t])

  // ===================== render =====================
  const header = (
    <div className="rm-head">
      <div className="rm-head-txt">
        <h2 className="rm-title">{gameName || t('lobby')}</h2>
        <p className="rm-sub">
          {table?.label || table?.name
            ? `${ar ? 'طاولة' : 'Table'} ${table.label || table.name}`
            : (tenant?.name || '')}
        </p>
      </div>
      <button type="button" className="rm-x rm-press" onClick={onExit} aria-label={t('back')}>
        <Icon name="close" size={18} />
      </button>
    </div>
  )

  // ---------- inside a room ----------
  if (roomId) {
    return (
      <div className="rm-root">
        {header}
        <div className="rm-scroll">
          <div className="rm-wrap">
            <div className="rm-card rm-fade">
              <div className="rm-code-box">
                <span className="rm-code-label">{t('code')}</span>
                <span className="rm-code">{roomId}</span>
              </div>
              <p className="rm-note">{t('codeHint')}</p>
              <div className="rm-link-row">
                <div className="rm-link" title={link}>{link}</div>
                <button
                  type="button"
                  className={`rm-copy rm-press${copied ? ' rm-copy-ok' : ''}`}
                  onClick={doCopy}
                  aria-label={copied ? t('copied') : t('copy')}
                >
                  <Icon name={copied ? 'check' : 'copy'} size={18} />
                </button>
              </div>
              <button type="button" className="rm-btn rm-btn-primary rm-press" onClick={doShare}>
                <Icon name="share" size={17} />
                {t('share')}
              </button>
            </div>

            <div className="rm-card rm-fade">
              <div className="rm-card-h">
                <Icon name="customers" size={16} />
                {t('seats')}
              </div>
              <ul className="rm-seats">
                {Array.from({ length: maxPlayers }).map((_, seat) => {
                  const p = players.find((x) => x.seat === seat)
                  if (!p) {
                    return (
                      <li className="rm-seat rm-seat-empty" key={`e${seat}`}>
                        <span className="rm-avatar"><Icon name="user" size={15} /></span>
                        <span className="rm-seat-body"><span className="rm-seat-name">{t('empty')}</span></span>
                      </li>
                    )
                  }
                  const live = isConnected(p, now)
                  const isMe = p.id === me.id
                  return (
                    <li className={`rm-seat${isMe ? ' rm-seat-me' : ''}`} key={p.id}>
                      <span className="rm-avatar">{(p.name || '?').trim().charAt(0) || '?'}</span>
                      <span className="rm-seat-body">
                        <span className="rm-seat-name">
                          {p.name}{isMe ? ` (${t('you')})` : ''}
                        </span>
                        <span className="rm-seat-meta">{live ? t('live') : t('away')}</span>
                      </span>
                      {room?.hostId === p.id ? <span className="rm-badge">{t('host')}</span> : null}
                      <span className={`rm-dot${live ? ' rm-dot-live' : ' rm-dot-off'}`} aria-hidden="true" />
                    </li>
                  )
                })}
              </ul>
            </div>

            {rules ? (
              <div className="rm-card rm-fade">
                <button
                  type="button"
                  className="rm-btn rm-btn-ghost rm-press"
                  onClick={() => setShowRules((v) => !v)}
                >
                  <Icon name="notepad" size={16} />
                  {t('rules')}
                </button>
                {showRules ? <p className="rm-note">{rules}</p> : null}
              </div>
            ) : null}

            {err ? <p className="rm-form-err">{err}</p> : null}
          </div>
        </div>

        <div className="rm-foot">
          <div className="rm-wrap">
            {waitingLine ? (
              <div className="rm-wait">
                <span className="rm-spin" aria-hidden="true" />
                {waitingLine}
              </div>
            ) : null}
            {canStart ? (
              <button
                type="button"
                className="rm-btn rm-btn-primary rm-press"
                onClick={doStart}
                disabled={busy === 'start'}
              >
                <Icon name="play" size={17} />
                {busy === 'start' ? t('joining') : t('start')}
              </button>
            ) : null}
            <button type="button" className="rm-btn rm-btn-ghost rm-press" onClick={doLeave}>
              {t('leave')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---------- choosing how to play ----------
  return (
    <div className="rm-root">
      {header}
      <div className="rm-scroll">
        <div className="rm-wrap">
          <div className="rm-card rm-fade">
            <div className="rm-card-h">
              <Icon name="tables" size={16} />
              {t('openRooms')}
            </div>
            {!table?.id ? (
              <p className="rm-note">{t('noTable')}</p>
            ) : openRooms.length === 0 ? (
              <p className="rm-note">{t('noOpen')}</p>
            ) : (
              <div className="rm-open">
                {openRooms.map((r) => {
                  const n = (r.players || []).length
                  const full = n >= (r.maxPlayers || MAX_SEATS)
                  const live = r.status === 'playing'
                  const mine = (r.players || []).some((p) => p.id === me.id)
                  return (
                    <button
                      type="button"
                      key={r.id}
                      className="rm-open-row rm-press"
                      onClick={() => doJoin(r.id)}
                      disabled={busy !== '' || (full && !mine) || (live && !mine)}
                    >
                      <span className="rm-open-body">
                        <span className="rm-open-title">
                          {(r.players || []).map((p) => p.name).filter(Boolean).join('، ') || r.id}
                        </span>
                        <span className="rm-open-meta">
                          {`${n}/${r.maxPlayers || MAX_SEATS}`}
                          {' · '}
                          {r.id}
                        </span>
                      </span>
                      <span className={`rm-pill${live ? ' rm-pill-live' : ''}`}>
                        {live ? t('playing') : t('waiting')}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            <button
              type="button"
              className="rm-btn rm-press"
              onClick={doCreate}
              disabled={busy !== ''}
            >
              <Icon name="add" size={17} />
              {busy === 'create' ? t('creating') : t('withTable')}
            </button>
          </div>

          <div className="rm-card rm-fade">
            <div className="rm-card-h">
              <Icon name="share" size={16} />
              {t('invite')}
            </div>
            <p className="rm-note">
              {ar
                ? 'ننشئ غرفة ونعطيك رابطاً ورمزاً — أرسل الرابط أو اقرأ الرمز على من معك.'
                : 'We create a room and give you a link and a code to share.'}
            </p>
            <button
              type="button"
              className="rm-btn rm-btn-primary rm-press"
              onClick={doCreate}
              disabled={busy !== ''}
            >
              <Icon name="add" size={17} />
              {busy === 'create' ? t('creating') : t('invite')}
            </button>
          </div>

          <div className="rm-card rm-fade">
            <div className="rm-card-h">
              <Icon name="key" size={16} />
              {t('byCode')}
            </div>
            <div className="rm-link-row">
              <input
                className="rm-input rm-input-ltr"
                value={codeInput}
                onChange={(e) => setCodeInput(normalizeRoomCode(e.target.value))}
                placeholder={t('codePh')}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck="false"
                aria-label={t('code')}
              />
              <button
                type="button"
                className="rm-copy rm-press"
                onClick={() => doJoin(codeInput)}
                disabled={codeInput.length < 6 || busy !== ''}
                aria-label={t('go')}
              >
                <Icon name="next" size={18} />
              </button>
            </div>
          </div>

          {err ? <p className="rm-form-err">{err}</p> : null}
        </div>
      </div>
    </div>
  )
}
