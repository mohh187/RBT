// «البث المباشر» — the manager's switchboard for what the venue's wall screens
// broadcast, and on WHICH paired screen. Mounted as a tab inside
// routes/admin/GamesHub.jsx.
//
// WRITES exactly one tenant field: `tenant.screenBroadcast` (shape documented
// in lib/spectate.js, normalizeScreenBroadcast — the single source of truth
// both sides normalize through):
//
//   tenant.screenBroadcast = {
//     version: 1,
//     mode: 'off' | 'tournaments' | 'all' | 'pinned',
//     pinnedRoomId: '',
//     screens: 'all' | ['CODE1', ...],
//   }
//
// Every control APPLIES IMMEDIATELY (one bounded write per tap) because this
// is a live broadcast desk, not a settings form: the signage player watches
// the tenant doc, so the wall obeys within a snapshot. The «يُعرض الآن» line
// at the top mirrors the exact decision the wall makes — same pick functions,
// same freshness windows — so what it says is what the room sees.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../Icon.jsx'
import { Spinner } from '../ui.jsx'
import { watchScreens } from '../../lib/db.js'
import {
  normalizeScreenBroadcast, BROADCAST_ROTATE_MS, SPECTATE_ROOM_STALE_MS,
  pickBroadcastRoom, countBroadcastRooms, pickSpectateRoom,
  watchLiveGameRooms, watchSpectatableMatch, spectateGameName, isSpectatableGame,
} from '../../lib/spectate.js'
import { watchLiveTournament } from '../../lib/socialPlay.js'
import { isBotPlayer } from '../../lib/gameBots.js'
import { fmtInt } from './engine.jsx'
import '../../styles/screen-appearance.css'

const num = (v, f = 0) => { const n = Number(v); return Number.isFinite(n) ? n : f }

// A paired TV heartbeats every 75s (ScreenPlayer) — 3 minutes of silence means
// it is genuinely not listening right now.
const SCREEN_ONLINE_MS = 3 * 60 * 1000

// The four modes, in the order a manager reasons about them: nothing → the
// safe default → everything → one table.
const MODES = [
  {
    key: 'off', icon: 'eyeOff', tone: 'off',
    ar: 'إيقاف البث', en: 'Broadcast off',
    descAr: 'لا تستولي أي مباراة على الشاشات — تبقى على قوائمها وعروضها المعتادة.',
    descEn: 'No match ever takes a screen over — playlists and offers only.',
  },
  {
    key: 'tournaments', icon: 'award', tone: 'gold',
    ar: 'البطولات فقط', en: 'Tournaments only',
    descAr: 'الوضع الافتراضي: تحديات الطاولات تُعرض دائماً، وطاولات الأصدقاء أثناء البطولات فقط.',
    descEn: 'The default: table challenges always; friendly tables only while a tournament runs.',
  },
  {
    key: 'all', icon: 'zap', tone: 'live',
    ar: 'كل الطاولات المباشرة', en: 'Any live table',
    descAr: 'أي طاولة تبدأ اللعب تظهر على الجدار فوراً — حتى بلا بطولة. عدة طاولات؟ تتناوب كل 45 ثانية.',
    descEn: 'Any table that starts playing takes the wall — no tournament needed. Several rotate every 45s.',
  },
  {
    key: 'pinned', icon: 'pin', tone: 'pin',
    ar: 'طاولة محددة', en: 'One pinned table',
    descAr: 'أنت تختار طاولة واحدة بعينها — تُعرض هي فقط، حتى لو كان لاعب واحد ضد الكمبيوتر.',
    descEn: 'You pick exactly one table — only it shows, even a solo player versus the computer.',
  },
]

// «أدم ضد الكمبيوتر» for two seats, a comma list for more. Bot players keep
// their honest stored name (gameRoom seats them as «الكمبيوتر…» — never as a
// human), and we add nothing on top.
function playersLine(room, ar) {
  const ps = (Array.isArray(room?.players) ? room.players : [])
    .slice()
    .sort((a, b) => num(a.seat) - num(b.seat))
    .map((p) => String(p?.name || '').trim() || (isBotPlayer(p) ? (ar ? 'الكمبيوتر' : 'Computer') : (ar ? 'ضيف' : 'Guest')))
  if (ps.length === 2) return ps.join(ar ? ' ضد ' : ' vs ')
  return ps.join(ar ? '، ' : ', ')
}

function screensLabel(cfg, screens, ar) {
  if (cfg.screens === 'all') {
    if (screens.length === 1) return screens[0].name || screens[0].id
    return ar ? 'جميع الشاشات المقترنة' : 'all paired screens'
  }
  const names = cfg.screens
    .map((code) => {
      const s = screens.find((x) => String(x.id).toUpperCase() === code)
      return s ? (s.name || s.id) : code
    })
  if (!names.length) return ar ? 'لا شاشة مختارة' : 'no screen selected'
  return names.join(ar ? '، ' : ', ')
}

// The same decision the wall makes, expressed as one honest sentence.
// Returns { tone: 'live' | 'idle' | 'off', text }.
function liveNow({ cfg, rooms, match, cupRunning, screens, ar, now }) {
  const on = (room, extra = '') => {
    const game = spectateGameName(room.gameId, ar ? 'ar' : 'en')
    const who = playersLine(room, ar)
    const where = screensLabel(cfg, screens, ar)
    return {
      tone: 'live',
      text: ar
        ? `يُعرض الآن: ${game} — ${who} على ${where}${extra}`
        : `Now showing: ${game} — ${who} on ${where}${extra}`,
    }
  }
  if (cfg.mode === 'off') {
    return { tone: 'off', text: ar ? 'البث متوقف — الشاشات تعرض قوائمها وعروضها المعتادة.' : 'Broadcast is off — screens play their normal playlists.' }
  }
  if (Array.isArray(cfg.screens) && cfg.screens.length === 0) {
    return { tone: 'off', text: ar ? 'لم تُختر أي شاشة — البث مفعّل لكنه لن يظهر على أي شاشة حتى تختار واحدة أدناه.' : 'No screen selected — broadcasting is on but will appear nowhere until you pick a screen below.' }
  }
  if (cfg.mode === 'pinned') {
    if (!cfg.pinnedRoomId) {
      return { tone: 'idle', text: ar ? 'لم تُثبَّت طاولة بعد — اختر واحدة من قائمة الطاولات المباشرة أدناه.' : 'No table pinned yet — pick one from the live list below.' }
    }
    const room = rooms.find((r) => String(r.roomId || r.id) === cfg.pinnedRoomId)
    if (room) return on(room)
    return { tone: 'idle', text: ar ? 'الطاولة المثبّتة ليست مباشرة الآن — ستُعرض تلقائياً لحظة بدء اللعب، وإلى حينها تعرض الشاشات قوائمها.' : 'The pinned table is not live right now — it will show the moment play starts; until then, playlists run.' }
  }
  // matches (table-versus-table challenges) outrank plain rooms on the wall
  const matchRoom = match && match.roomId ? rooms.find((r) => String(r.roomId || r.id) === String(match.roomId)) : null
  if (matchRoom) {
    return on(matchRoom, ar ? ' (تحدٍّ بين طاولتين)' : ' (table challenge)')
  }
  if (cfg.mode === 'tournaments') {
    if (!cupRunning) {
      return { tone: 'idle', text: ar ? 'لا بطولة جارية الآن، فلا تُعرض طاولات الأصدقاء. تحديات الطاولات تُعرض تلقائياً لحظة بدئها.' : 'No tournament is running, so friendly tables are not shown. Table challenges still show automatically.' }
    }
    const room = pickSpectateRoom(rooms, now)
    if (room) return on(room)
    return { tone: 'idle', text: ar ? 'البطولة جارية ولا طاولة مباشرة الآن — أول طاولة تبدأ ستظهر على الشاشة تلقائياً.' : 'Tournament running, no live table yet — the first one to start will take the screen.' }
  }
  // mode 'all'
  const room = pickBroadcastRoom(rooms, now)
  if (room) {
    const n = countBroadcastRooms(rooms, now)
    const extra = n > 1
      ? (ar ? ` — بالتناوب بين ${fmtInt(n)} طاولات، ${fmtInt(Math.round(BROADCAST_ROTATE_MS / 1000))} ثانية لكل طاولة` : ` — rotating across ${fmtInt(n)} tables, ${fmtInt(Math.round(BROADCAST_ROTATE_MS / 1000))}s each`)
      : ''
    return on(room, extra)
  }
  return { tone: 'idle', text: ar ? 'لا توجد طاولة مباشرة الآن — أول طاولة تبدأ اللعب ستظهر على الشاشة تلقائياً، بلا أي إعداد إضافي.' : 'No table is live right now — the first one to start playing takes the screen automatically.' }
}

export default function BroadcastControl({ ar = true, tenantId, tenant, canEdit = false, onSave }) {
  const cfg = useMemo(() => normalizeScreenBroadcast(tenant?.screenBroadcast), [tenant?.screenBroadcast])
  const [busy, setBusy] = useState(false)

  // -- live inputs (bounded listeners, same sources the wall reads) ---------
  const [screens, setScreens] = useState(null)   // paired TVs; null = loading
  const [roomsRaw, setRoomsRaw] = useState(null) // playing rooms; null = loading
  const [match, setMatch] = useState(null)
  const [cupRunning, setCupRunning] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 10000)
    return () => clearInterval(iv)
  }, [])
  useEffect(() => {
    if (!tenantId) return undefined
    return watchScreens(tenantId, (rows) => setScreens(Array.isArray(rows) ? rows : []))
  }, [tenantId])
  useEffect(() => {
    if (!tenantId) return undefined
    const u1 = watchLiveGameRooms(tenantId, ({ rooms }) => setRoomsRaw(rooms || []))
    const u2 = watchSpectatableMatch(tenantId, ({ match: m }) => setMatch(m || null))
    const u3 = watchLiveTournament(tenantId, ({ tournament }) => setCupRunning(!!tournament))
    return () => { u1(); u2(); u3() }
  }, [tenantId])

  // Only rooms the wall could actually show: certified game + fresh enough.
  const rooms = useMemo(() => (roomsRaw || [])
    .filter((r) => r && r.status === 'playing' && isSpectatableGame(r.gameId))
    .filter((r) => num(r.updatedAt) >= now - SPECTATE_ROOM_STALE_MS)
    .sort((a, b) => num(b.updatedAt) - num(a.updatedAt)),
  [roomsRaw, now])

  const write = async (patch) => {
    if (!canEdit || busy) return
    setBusy(true)
    try {
      await onSave(normalizeScreenBroadcast({ ...cfg, ...patch }))
    } catch (_) {
      // onSave surfaces its own toast
    } finally { setBusy(false) }
  }

  const scr = screens || []
  const allScreens = cfg.screens === 'all'
  const toggleScreen = (code) => {
    const c = String(code).toUpperCase()
    const cur = allScreens ? scr.map((s) => String(s.id).toUpperCase()) : cfg.screens
    const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]
    write({ screens: next })
  }

  const status = liveNow({ cfg, rooms, match, cupRunning, screens: scr, ar, now })
  const loading = screens === null || roomsRaw === null

  return (
    <div className="ga-stack">
      {/* ------------------------------------------------ «يُعرض الآن» bar */}
      <div className={`ga-card bc-now is-${status.tone}`}>
        <span className={`bc-now-dot is-${status.tone}`} aria-hidden="true" />
        <div className="bc-now-txt">
          <span className="bc-now-l">{ar ? 'حالة البث' : 'Broadcast status'}</span>
          <strong>{loading ? (ar ? 'جارٍ القراءة…' : 'Reading…') : status.text}</strong>
        </div>
        {loading && <Spinner />}
      </div>

      {!canEdit && (
        <div className="ga-card">
          <p className="ga-hint">
            {ar
              ? 'أنت تشاهد الإعداد الحالي فقط — تغييره يحتاج صلاحية الإعدادات.'
              : 'You are viewing the current setting only — changing it needs the settings permission.'}
          </p>
        </div>
      )}

      {/* ------------------------------------------------------ mode cards */}
      <div className="ga-card">
        <div className="ga-card-t">
          <Icon name="wifi" size={15} /> {ar ? 'ماذا يُبث على الشاشات؟' : 'What broadcasts?'}
          <span className="ga-grow" />
          {busy && <Spinner />}
        </div>
        <p className="ga-hint">
          {ar
            ? 'يُطبّق فوراً على كل شاشة معرض مقترنة. لا تُعرض إلا الألعاب المعتمدة للشاشات العامة، وأوراق اللاعبين لا تظهر أبداً.'
            : 'Applies instantly to every paired screen. Only games certified for public screens are shown — nobody’s hand ever appears.'}
        </p>
        <div className="bc-modes">
          {MODES.map((m) => (
            <button
              key={m.key} type="button" disabled={!canEdit || busy}
              className={`bc-mode is-${m.tone}${cfg.mode === m.key ? ' active' : ''}`}
              aria-pressed={cfg.mode === m.key}
              onClick={() => write({ mode: m.key })}
            >
              <span className="bc-mode-ic"><Icon name={m.icon} size={20} /></span>
              <strong>{ar ? m.ar : m.en}</strong>
              <span className="bc-mode-d">{ar ? m.descAr : m.descEn}</span>
              {cfg.mode === m.key && <span className="bc-mode-on"><Icon name="check" size={12} /> {ar ? 'المفعّل الآن' : 'Active'}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* --------------------------------------------- pinned-table picker */}
      {cfg.mode === 'pinned' && (
        <div className="ga-card">
          <div className="ga-card-t">
            <Icon name="pin" size={15} /> {ar ? 'الطاولة المثبّتة' : 'Pinned table'}
            <span className="ga-grow" />
            <span className="ga-of ga-num">{fmtInt(rooms.length)} {ar ? 'مباشرة الآن' : 'live now'}</span>
          </div>
          {rooms.length === 0 ? (
            <>
              <p className="ga-empty-t">{ar ? 'لا توجد طاولة مباشرة الآن' : 'No live table right now'}</p>
              <p className="ga-hint">
                {ar
                  ? 'عندما يبدأ ضيوف — أو لاعب واحد ضد الكمبيوتر — جولة، تظهر طاولتهم هنا فوراً لتثبيتها على الشاشة.'
                  : 'When guests — or one player versus the computer — start a round, their table appears here instantly.'}
              </p>
            </>
          ) : (
            <div className="bc-rooms">
              {rooms.map((r) => {
                const id = String(r.roomId || r.id)
                const active = cfg.pinnedRoomId === id
                return (
                  <button
                    key={id} type="button" disabled={!canEdit || busy}
                    className={`bc-room${active ? ' active' : ''}`}
                    aria-pressed={active}
                    onClick={() => write({ pinnedRoomId: active ? '' : id })}
                  >
                    <span className="bc-room-live" aria-hidden="true" />
                    <span className="bc-room-g">{spectateGameName(r.gameId, ar ? 'ar' : 'en')}</span>
                    <span className="bc-room-p">{playersLine(r, ar)}</span>
                    <span className="bc-room-meta ga-num">
                      {r.tableLabel ? `${r.tableLabel} · ` : ''}{ar ? 'رمز' : 'code'} {id}
                    </span>
                    <span className="bc-room-pick">{active ? (ar ? 'مثبّتة — تُعرض الآن' : 'Pinned — showing') : (ar ? 'تثبيت' : 'Pin')}</span>
                  </button>
                )
              })}
            </div>
          )}
          {cfg.pinnedRoomId && !rooms.some((r) => String(r.roomId || r.id) === cfg.pinnedRoomId) && (
            <p className="ga-hint">
              {ar
                ? 'الطاولة المثبّتة سابقاً ليست مباشرة الآن — إن عادت للعب تُعرض من جديد، أو ثبّت غيرها.'
                : 'The previously pinned table is not live now — pin another, or it will show again if play resumes.'}
            </p>
          )}
        </div>
      )}

      {/* -------------------------------------------------- screens picker */}
      <div className="ga-card">
        <div className="ga-card-t">
          <Icon name="qr" size={15} /> {ar ? 'على أي شاشة؟' : 'On which screens?'}
          <span className="ga-grow" />
          <span className="ga-of ga-num">{fmtInt(scr.length)} {ar ? 'شاشة مقترنة' : 'paired'}</span>
        </div>
        {scr.length === 0 ? (
          <>
            <p className="ga-empty-t">{ar ? 'لا توجد شاشات مقترنة بعد' : 'No paired screens yet'}</p>
            <p className="ga-hint">
              {ar ? 'أنشئ شاشة عرض واربطها بأي تلفزيون أولاً، ثم عد هنا لاختيار أيها يعرض البث. ' : 'Create and pair a display first, then choose here which of them broadcasts. '}
              <Link className="ga-link" to="/admin/screens">{ar ? 'فتح إدارة الشاشات' : 'Open screens'}</Link>
            </p>
          </>
        ) : (
          <>
            <label className={`bc-allscreens${!canEdit ? ' is-off' : ''}`}>
              <input
                type="checkbox" checked={allScreens} disabled={!canEdit || busy}
                onChange={(e) => write({ screens: e.target.checked ? 'all' : scr.map((s) => String(s.id).toUpperCase()) })}
              />
              <span className="bc-check" aria-hidden="true"><Icon name="check" size={12} /></span>
              <b>{ar ? 'جميع الشاشات' : 'All screens'}</b>
              <span className="ga-of">{ar ? 'كل شاشة مقترنة الآن أو مستقبلاً تعرض البث' : 'every screen, current and future'}</span>
            </label>
            <div className="bc-screens">
              {scr.map((s) => {
                const code = String(s.id).toUpperCase()
                const picked = allScreens || cfg.screens.includes(code)
                const online = num(s.lastSeenAt) >= now - SCREEN_ONLINE_MS
                return (
                  <label key={s.id} className={`bc-screen${picked ? ' active' : ''}${allScreens || !canEdit ? ' is-locked' : ''}`}>
                    <input
                      type="checkbox" checked={picked}
                      disabled={!canEdit || busy || allScreens}
                      onChange={() => toggleScreen(code)}
                    />
                    <span className="bc-check" aria-hidden="true"><Icon name="check" size={12} /></span>
                    <span className="bc-screen-n">{s.name || (ar ? 'شاشة بلا اسم' : 'Unnamed screen')}</span>
                    <span className="bc-screen-c ga-num" dir="ltr">{code}</span>
                    <span className={`bc-screen-s${online ? ' is-on' : ''}`}>
                      {online ? (ar ? 'متصلة الآن' : 'online') : (ar ? 'غير متصلة' : 'offline')}
                    </span>
                  </label>
                )
              })}
            </div>
            {!allScreens && cfg.screens.length === 0 && (
              <div className="ga-warn">
                <Icon name="warning" size={15} />
                <span>{ar ? 'لم تُختر أي شاشة — البث لن يظهر في أي مكان حتى تختار شاشة واحدة على الأقل.' : 'No screen selected — the broadcast will appear nowhere until you pick at least one.'}</span>
              </div>
            )}
            {!allScreens && cfg.screens.some((c) => !scr.some((s) => String(s.id).toUpperCase() === c)) && (
              <p className="ga-hint">
                {ar
                  ? 'بعض الشاشات المختارة سابقاً حُذفت من إدارة الشاشات — اختيارها محفوظ لكنه بلا أثر.'
                  : 'Some previously selected screens were deleted — their selection is kept but has no effect.'}
              </p>
            )}
          </>
        )}
      </div>

      <p className="ga-hint ga-foot">
        {ar
          ? 'الخصوصية محفوظة دائماً: أوراق اللاعبين تُحجب على الشاشة العامة مهما كان الوضع، والألعاب غير المعتمدة للعرض لا تظهر إطلاقاً.'
          : 'Privacy holds in every mode: hands are always redacted on the public screen, and uncertified games never show at all.'}
      </p>
    </div>
  )
}
