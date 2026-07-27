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
import CoverPlate from './CoverPlate.jsx'
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
  fillWithBots,
  removeBot,
  HEARTBEAT_MS,
  MAX_SEATS,
} from '../../lib/gameRoom.js'
import { setSoloIntent, clearSoloIntent, botNote, botLabel, isBotPlayer, BOTS } from '../../lib/gameBots.js'
import '../../styles/room.css'
import '../../styles/gamebots.css'

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
  inviteH: { ar: 'ادعُ من يلعب معك', en: 'Invite your players' },
  codeTap: { ar: 'انقر لنسخ الرمز', en: 'Tap to copy the code' },
  codeCopied: { ar: 'تم نسخ الرمز', en: 'Code copied' },
  seats: { ar: 'طاولة اللعب', en: 'The table' },
  host: { ar: 'المضيف', en: 'Host' },
  you: { ar: 'أنت', en: 'You' },
  empty: { ar: 'مقعد شاغر', en: 'Empty seat' },
  away: { ar: 'انقطع — مقعده محفوظ', en: 'Away — seat kept' },
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

  // ---- «العب ضد الكمبيوتر» ----
  soloH: { ar: 'العب ضد الكمبيوتر', en: 'Play the computer' },
  soloWhy: {
    ar: 'وحدك على الطاولة؟ ابدأ الآن دون انتظار أحد — تلعب على جهازك فقط، بلا غرفة وبلا رابط.',
    en: 'On your own? Start now without waiting — played on your device alone, no room, no link.',
  },
  soloCount: { ar: 'عدد الخصوم', en: 'Opponents' },
  soloFixed: {
    ar: 'هذه اللعبة لأربعة لاعبين، فتلعب مع شريك وخصمين يديرهم الجهاز.',
    en: 'This game seats four, so you get one computer partner and two computer opponents.',
  },
  soloFixed2: {
    ar: 'الشطرنج للاعبين اثنين، فيلعب الكمبيوتر بالأسود وتلعب أنت بالأبيض.',
    en: 'Chess seats two: the computer takes black, you take white.',
  },
  soloGo: { ar: 'ابدأ ضد الكمبيوتر', en: 'Start against the computer' },
  soloYou: { ar: 'أنت', en: 'You' },
  soloTable: { ar: 'الطاولة', en: 'At the table' },

  // ---- computer seats in a REAL room («أكمل المقاعد بالكمبيوتر») ----
  fillAll: { ar: 'أكمل المقاعد الشاغرة بالكمبيوتر', en: 'Fill the empty seats with the computer' },
  fillNote: {
    ar: 'الكمبيوتر يلعب من جهاز المضيف — إن انقطع المضيف توقّفت مقاعد الكمبيوتر حتى يعود، وإن انضم صديق قبل البدء أخذ مكان أحدها.',
    en: 'The computer plays from the host device — if the host drops, computer seats pause until the host is back; a friend joining before the start takes a computer seat.',
  },
  filling: { ar: 'نجهّز مقاعد الكمبيوتر…', en: 'Seating the computer…' },
  sideQ: { ar: 'الكمبيوتر معنا أم ضدنا؟', en: 'Computer with us, or against us?' },
  sideFoes: { ar: 'ضدنا — نلعب نحن شريكين', en: 'Against us — we partner up' },
  sidePartners: { ar: 'معنا — لكلٍّ منا شريك كمبيوتر', en: 'With us — a computer partner each' },
  botTag: { ar: 'آلي', en: 'Bot' },
  botSeatMeta: { ar: 'من جهاز المضيف', en: 'From the host device' },
  botRemove: { ar: 'إزالة هذا المقعد الآلي', en: 'Remove this computer seat' },
  soloRoomWhy: {
    ar: 'أو العبها كغرفة حقيقية: تظهر للمكان ويمكن بثّها على الشاشة، وإن جاء صديق قبل البدء أخذ مكان الكمبيوتر.',
    en: 'Or play it as a real room: the venue can see it and put it on the wall screen, and a friend arriving before the start replaces a computer seat.',
  },
  soloRoomGo: { ar: 'العب ضد الكمبيوتر على الشاشة', en: 'Play the computer on the big screen' },
}

// Arabic ordinals for the honest waiting line («بانتظار لاعب ثالث…»).
const ORDINAL_AR = ['', 'أول', 'ثاني', 'ثالث', 'رابع']

// Partnership games pair seats 0+2 against 1+3. Only these two ever raise the
// «الكمبيوتر معنا أم ضدنا؟» question when two people fill two machine seats.
const TEAM_GAMES = new Set(['wist', 'jackaroo'])

// The host's crown — a small bespoke glyph (SVG only, hard repo rule).
const CROWN = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M3 19h18v2H3zM2.6 17 4.4 7.6l4.7 4.2L12 4l2.9 7.8 4.7-4.2L21.4 17z" />
  </svg>
)

export default function RoomLobby({
  tid,
  tenant = null,
  game = null,
  table = null,
  player = null,
  lang = 'ar',
  onStart,
  onExit,
  // Called when the player chooses «العب ضد الكمبيوتر»: { gameId, bots }.
  // The hub owns that route because a solo round is a normal single-player run
  // (play history, restart, exit) and NOT a room. When the hub has not wired it
  // yet, `onStart('')` is used instead — see doSolo.
  onSolo,
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
  const [codeCopied, setCodeCopied] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [rules, setRules] = useState('')
  const [showRules, setShowRules] = useState(false)

  const startedRef = useRef(false)
  const modRef = useRef(null)

  // Entering (or leaving) a room swaps the whole body under a reused scroll
  // container, which would otherwise keep the OLD scroll offset and open the
  // room view with the code chip pushed out of sight. Presentation only.
  const scrollerRef = useRef(null)
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
  }, [roomId])

  const maxPlayers = Math.max(2, Math.min(MAX_SEATS, Number(game?.maxPlayers) || 2))
  const minPlayers = Math.max(2, Math.min(maxPlayers, Number(game?.minPlayers) || 2))
  const gameName = ar ? (game?.ar || '') : (game?.en || game?.ar || '')

  // ---- «العب ضد الكمبيوتر» ----
  // The player always takes seat zero, so the number of machine seats is bounded
  // by the game's own registry entry: at least enough to reach minPlayers, never
  // more than maxPlayers allows. Nothing here invents a seat count.
  const minBots = Math.max(1, minPlayers - 1)
  const maxBots = Math.max(minBots, maxPlayers - 1)
  const botChoices = useMemo(() => {
    const out = []
    for (let n = minBots; n <= maxBots; n += 1) out.push(n)
    return out
  }, [minBots, maxBots])
  const [botCount, setBotCount] = useState(minBots)
  useEffect(() => { setBotCount(minBots) }, [minBots])
  const strength = botNote(game?.id, lang)

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
  // The player chose people over machines: drop any solo hand-off before it can
  // be picked up by the board this room is about to open.
  const doSolo = useCallback(() => {
    if (busy || !game?.id) return
    const n = Math.max(minBots, Math.min(maxBots, Number(botCount) || minBots))
    setSoloIntent({ gameId: game.id, bots: n })
    if (typeof onSolo === 'function') { onSolo({ gameId: game.id, bots: n }); return }
    // The hub has not wired `onSolo` yet. `onStart('')` still lands on the same
    // board with no room attached, which is exactly what solo mode is; the
    // hand-off above tells the game how many machine seats to open.
    onStart?.('')
  }, [busy, game?.id, botCount, minBots, maxBots, onSolo, onStart])

  const doCreate = useCallback(async () => {
    if (busy) return
    clearSoloIntent()
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
    clearSoloIntent()
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
        // Games that pre-pick their opener bake it into the state (Dominoes
        // stamps the highest-double holder in st.turn). Without handing that
        // seat to the room's turn gate, the opener's first move is rejected
        // and the table silently freezes on the deal.
        firstSeat: Number.isInteger(st?.turn) ? st.turn : 0,
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

  // ---- computer seats in the room («أكمل المقاعد بالكمبيوتر») ----
  // Host-only. `arrange` decides who partners whom in Wist/Jackaroo when two
  // people fill two machine seats: 'foes' keeps the people together (0+2) with
  // both bots opposite; 'partners' gives each person a bot partner. Everything
  // else fills the lowest free seats. The bots are MOVED by the host's device
  // once the round starts (gameRoom.botTurnSeat drives that in the hub).
  const doFill = useCallback(async (arrange) => {
    if (busy || !roomId) return
    setBusy('fill'); setErr('')
    try {
      await fillWithBots({ tid, roomId, playerId: me.id, arrange, lang })
    } catch (e) {
      setErr(roomErrorText(e))
    } finally {
      setBusy('')
    }
  }, [busy, tid, roomId, me.id, lang])

  const doRemoveBot = useCallback(async (seat) => {
    if (busy || !roomId) return
    setBusy('unbot'); setErr('')
    try {
      await removeBot({ tid, roomId, playerId: me.id, seat, lang })
    } catch (e) {
      setErr(roomErrorText(e))
    } finally {
      setBusy('')
    }
  }, [busy, tid, roomId, me.id, lang])

  // «العب ضد الكمبيوتر على الشاشة»: the same fight as doSolo but in a REAL
  // room — one person, machine seats — so the venue wall can broadcast it and
  // a friend arriving before the start simply takes over a computer seat
  // (joinRoom displaces the highest-seated bot). Starting stays the host's
  // tap, exactly like any other room, so the code and link are readable first.
  const doSoloRoom = useCallback(async () => {
    if (busy || !game?.id) return
    clearSoloIntent()
    setBusy('soloroom'); setErr('')
    try {
      const n = Math.max(minBots, Math.min(maxBots, Number(botCount) || minBots))
      const id = await createRoom({
        tid,
        gameId: game.id,
        table,
        player: me,
        maxPlayers,
        minPlayers,
        initialState: {},
        turnMs: Number(game?.turnMs) || 0,
      })
      await fillWithBots({ tid, roomId: id, playerId: me.id, count: n, lang })
      setMySeat(0)
      setRoomId(id)
    } catch (e) {
      setErr(roomErrorText(e))
    } finally {
      setBusy('')
    }
  }, [busy, game, tid, table, me, maxPlayers, minPlayers, botCount, minBots, maxBots, lang])

  // Carry the host's table into the invite so a friend who joins the game at
  // table 5 can also order to table 5.
  const link = roomId ? inviteUrl(tid, roomId, tenant?.slug, table?.qrToken) : ''

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

  // Tapping the big code chip copies the CODE itself (the thing you read out
  // loud); the link row below owns copying the full URL. Presentation only.
  const doCopyCode = useCallback(async () => {
    if (!roomId) return
    try {
      await navigator.clipboard.writeText(roomId)
    } catch (_) {
      const ta = document.createElement('textarea')
      ta.value = roomId
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch (_) { /* nothing more we can do */ }
      document.body.removeChild(ta)
    }
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 1800)
  }, [roomId])

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

  // ---- computer-seat facts (drive the fill affordance and the seat rows) ----
  const botsInRoom = players.filter(isBotPlayer)
  const humansInRoom = seated - botsInRoom.length
  const freeSeats = maxPlayers - seated
  const gameHasBot = !!BOTS[game?.id]
  // Exactly two people, exactly two machine seats, in a partnership game:
  // the only shape where WHO partners WHOM is genuinely ambiguous.
  const askSides = TEAM_GAMES.has(game?.id)
    && maxPlayers === 4 && humansInRoom === 2 && freeSeats === 2 && botsInRoom.length === 0

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
  // The game's own cover accent electrifies the house palette (room.css reads
  // these two variables everywhere: chips, rings, glows). Palette shape is the
  // cover spec from games.js: [deep, mid, hi, extra?].
  const covPal = Array.isArray(game?.cover?.palette) ? game.cover.palette : []
  const rootStyle = {
    '--rm-acc': covPal[1] || undefined,
    '--rm-acc-hi': covPal[2] || undefined,
  }

  const header = (
    <div className="rm-hero rm-fade">
      <CoverPlate game={game} className="rm-hero-art" />
      <span className="rm-hero-scrim" aria-hidden="true" />
      <button type="button" className="rm-x rm-press" onClick={onExit} aria-label={t('back')}>
        <Icon name="close" size={18} />
      </button>
      <div className="rm-hero-body">
        <h2 className="rm-title">{gameName || t('lobby')}</h2>
        <div className="rm-hero-chips">
          {game?.cover?.players ? (
            <span className="rm-chip rm-chip-acc">
              <Icon name="customers" size={12} />
              <span className="rm-chip-num">{game.cover.players}</span>
            </span>
          ) : null}
          {table?.label || table?.name ? (
            <span className="rm-chip">
              <Icon name="tables" size={12} />
              {`${ar ? 'طاولة' : 'Table'} ${table.label || table.name}`}
            </span>
          ) : tenant?.name ? (
            <span className="rm-chip">
              <Icon name="store" size={12} />
              {tenant.name}
            </span>
          ) : null}
          {roomId ? (
            <span className="rm-chip rm-chip-gold">
              <span className={`rm-dot${room?.status === 'lobby' ? ' rm-dot-live' : ''}`} aria-hidden="true" />
              <span className="rm-chip-num">{`${seated}/${maxPlayers}`}</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )

  // ---------- inside a room ----------
  if (roomId) {
    return (
      <div className="rm-root" style={rootStyle}>
        {header}
        <div className="rm-scroll" ref={scrollerRef}>
          <div className="rm-wrap">
            <div className="rm-card rm-fade">
              <div className="rm-card-h">
                <span className="rm-card-ico"><Icon name="share" size={15} /></span>
                {t('inviteH')}
              </div>
              <button
                type="button"
                className={`rm-code-box rm-press${codeCopied ? ' rm-code-ok' : ''}`}
                onClick={doCopyCode}
                aria-label={codeCopied ? t('codeCopied') : t('codeTap')}
              >
                <span className="rm-code-label">{t('code')}</span>
                <span className="rm-code">{roomId}</span>
                <span className="rm-code-hint">
                  <Icon name={codeCopied ? 'check' : 'copy'} size={12} />
                  {codeCopied ? t('codeCopied') : t('codeTap')}
                </span>
              </button>
              <div className="rm-actions">
                <button type="button" className="rm-btn rm-btn-primary rm-press" onClick={doShare}>
                  <Icon name="share" size={17} />
                  {t('share')}
                </button>
                <button
                  type="button"
                  className={`rm-btn rm-press${copied ? ' rm-btn-ok' : ''}`}
                  onClick={doCopy}
                  aria-label={copied ? t('copied') : t('copy')}
                >
                  <Icon name={copied ? 'check' : 'copy'} size={17} />
                  {copied ? t('copied') : t('copy')}
                </button>
              </div>
              <div className="rm-link" title={link}>{link}</div>
              <p className="rm-note">{t('codeHint')}</p>
            </div>

            <div className="rm-card rm-fade">
              <div className="rm-card-h">
                <span className="rm-card-ico"><Icon name="customers" size={15} /></span>
                {t('seats')}
                <span className="rm-count">{`${seated}/${maxPlayers}`}</span>
              </div>
              <ul className={`rm-seats${maxPlayers === 2 ? ' rm-seats-2' : ''}`}>
                {Array.from({ length: maxPlayers }).map((_, seat) => {
                  const p = players.find((x) => x.seat === seat)
                  if (!p) {
                    return (
                      <li className="rm-seat rm-seat-empty" key={`e${seat}`}>
                        <span className="rm-avatar"><Icon name="user" size={16} /></span>
                        <span className="rm-seat-body"><span className="rm-seat-name">{t('empty')}</span></span>
                      </li>
                    )
                  }
                  // A machine seat: labelled «الكمبيوتر», marked «آلي», never
                  // dressed as a person. It has no presence of its own — the
                  // meta line says where its moves actually come from. The
                  // host can hand the chair back to people while still in the
                  // lobby; once playing, seats are frozen like everyone's.
                  if (isBotPlayer(p)) {
                    return (
                      <li className="rm-seat rm-seat-bot" key={p.id}>
                        <span className="rm-avatar"><Icon name="grid" size={15} /></span>
                        <span className="rm-seat-body">
                          <span className="rm-seat-name">
                            {p.name}
                            <span className="rm-pill" style={{ marginInlineStart: 6 }}>{t('botTag')}</span>
                          </span>
                          <span className="rm-seat-meta">
                            <span className="rm-dot rm-dot-live" aria-hidden="true" />
                            {t('botSeatMeta')}
                          </span>
                        </span>
                        {iAmHost && room?.status === 'lobby' ? (
                          <button
                            type="button"
                            className="rm-press"
                            onClick={() => doRemoveBot(p.seat)}
                            disabled={busy !== ''}
                            aria-label={t('botRemove')}
                            title={t('botRemove')}
                            style={{ background: 'none', border: 0, color: 'inherit', opacity: 0.72, cursor: 'pointer', padding: 4 }}
                          >
                            <Icon name="close" size={14} />
                          </button>
                        ) : null}
                      </li>
                    )
                  }
                  const live = isConnected(p, now)
                  const isMe = p.id === me.id
                  return (
                    <li className={`rm-seat${isMe ? ' rm-seat-me' : ''}`} key={p.id}>
                      {room?.hostId === p.id ? (
                        <span className="rm-crown" role="img" aria-label={t('host')} title={t('host')}>{CROWN}</span>
                      ) : null}
                      <span className="rm-avatar">{(p.name || '?').trim().charAt(0) || '?'}</span>
                      <span className="rm-seat-body">
                        <span className="rm-seat-name">
                          {p.name}{isMe ? ` (${t('you')})` : ''}
                        </span>
                        <span className="rm-seat-meta">
                          <span className={`rm-dot${live ? ' rm-dot-live' : ' rm-dot-off'}`} aria-hidden="true" />
                          {live ? t('live') : t('away')}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
              {/* ---- «أكمل المقاعد بالكمبيوتر» --------------------------------
                  Host-only while the room is still a lobby. Wist/Jackaroo with
                  exactly two people and two empty chairs ask the one question
                  that matters — who partners whom — and every other shape is
                  one tap. The note is the honest limitation, stated up front:
                  the machines play from the host's device. */}
              <div className="rm-botfill-slot">
                {iAmHost && room?.status === 'lobby' && gameHasBot && freeSeats > 0 ? (
                  askSides ? (
                    <>
                      <p className="rm-note">{t('sideQ')}</p>
                      <div className="rm-actions">
                        <button
                          type="button"
                          className="rm-btn rm-btn-primary rm-press"
                          onClick={() => doFill('foes')}
                          disabled={busy !== ''}
                        >
                          <Icon name="grid" size={16} />
                          {busy === 'fill' ? t('filling') : t('sideFoes')}
                        </button>
                        <button
                          type="button"
                          className="rm-btn rm-press"
                          onClick={() => doFill('partners')}
                          disabled={busy !== ''}
                        >
                          <Icon name="customers" size={16} />
                          {busy === 'fill' ? t('filling') : t('sidePartners')}
                        </button>
                      </div>
                      <p className="rm-note">{t('fillNote')}</p>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="rm-btn rm-press"
                        onClick={() => doFill('auto')}
                        disabled={busy !== ''}
                      >
                        <Icon name="grid" size={16} />
                        {busy === 'fill' ? t('filling') : t('fillAll')}
                      </button>
                      <p className="rm-note">{t('fillNote')}</p>
                    </>
                  )
                ) : botsInRoom.length > 0 ? (
                  <p className="rm-note">{t('fillNote')}</p>
                ) : null}
              </div>
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
    <div className="rm-root" style={rootStyle}>
      {header}
      <div className="rm-scroll" ref={scrollerRef}>
        <div className="rm-wrap">
          {/* First on the screen on purpose: a guest sitting alone should not
              have to read past two "invite someone" options to find the one
              answer that works for them. */}
          <div className="rm-card rm-fade gbot-card">
            <div className="rm-card-h">
              <span className="rm-card-ico"><Icon name="zap" size={15} /></span>
              {t('soloH')}
            </div>
            <p className="gbot-note">{t('soloWhy')}</p>

            {botChoices.length > 1 ? (
              <div className="gbot-count">
                <span className="gbot-count-l">{t('soloCount')}</span>
                <span className="gbot-seg" role="group" aria-label={t('soloCount')}>
                  {botChoices.map((n) => (
                    <button
                      type="button"
                      key={n}
                      className={`gbot-segb${botCount === n ? ' is-on' : ''}`}
                      aria-pressed={botCount === n}
                      onClick={() => setBotCount(n)}
                    >
                      {n}
                    </button>
                  ))}
                </span>
              </div>
            ) : (
              <p className="gbot-note">{game?.id === 'chess' ? t('soloFixed2') : t('soloFixed')}</p>
            )}

            {/* Who will actually be at the table. A machine seat is labelled
                «الكمبيوتر», never given a name, never shown as a person. */}
            <ul className="gbot-seats" aria-label={t('soloTable')}>
              <li className="gbot-seatchip" data-you="1">
                <Icon name="user" size={13} />
                {me.name || t('soloYou')}
              </li>
              {Array.from({ length: botCount }).map((_, i) => (
                <li className="gbot-seatchip" key={i}>
                  <Icon name="grid" size={13} />
                  {botLabel(i, botCount, lang)}
                </li>
              ))}
            </ul>

            {/* The one claim this screen makes about how well it plays. It
                describes what the bot computes, not how strong it feels. */}
            {strength ? (
              <p className="gbot-strength">
                <Icon name="notepad" size={13} />
                <span>{strength}</span>
              </p>
            ) : null}

            <button
              type="button"
              className="rm-btn rm-btn-primary rm-press"
              onClick={doSolo}
              disabled={busy !== ''}
            >
              <Icon name="play" size={17} />
              {t('soloGo')}
            </button>

            {/* The same fight in a REAL room: broadcastable on the venue wall,
                and a friend arriving before the start takes a computer seat. */}
            <p className="gbot-note">{t('soloRoomWhy')}</p>
            <button
              type="button"
              className="rm-btn rm-press"
              onClick={doSoloRoom}
              disabled={busy !== ''}
            >
              <Icon name="sparkles" size={16} />
              {busy === 'soloroom' ? t('creating') : t('soloRoomGo')}
            </button>
          </div>

          <div className="rm-card rm-fade">
            <div className="rm-card-h">
              <span className="rm-card-ico"><Icon name="tables" size={15} /></span>
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
              <span className="rm-card-ico"><Icon name="share" size={15} /></span>
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
              <span className="rm-card-ico"><Icon name="key" size={15} /></span>
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
