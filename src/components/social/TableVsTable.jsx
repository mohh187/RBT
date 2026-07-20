// ===========================================================================
// طاولة ضد طاولة — table four challenges table nine, and the whole room knows
// the score.
//
// This component owns the MATCH (who challenged whom, and what the result was).
// It owns none of the GAME: the moment a challenge is accepted it creates a
// room with lib/gameRoom.js and hands the id up through onOpenRoom. There is
// exactly one room system in this product and this is not a second one.
//
// The match document is the durable part. A room can end, be abandoned, or be
// re-created; the match survives all three and carries the result, which is why
// the scoreboard reads from the match and only borrows the room for the live
// numbers while a round is actually running.
// ===========================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { Card, Head, useBrand, useWatch, pick } from './parts.jsx'
import {
  watchTableMatches,
  watchVenueTables,
  createMatch,
  acceptMatch,
  setMatchStatus,
  settleMatchFromRoom,
  matchSideFor,
  matchWinner,
  resolvePlayer,
  fmtNum,
} from '../../lib/socialPlay.js'
import { createRoom, watchRoom } from '../../lib/gameRoom.js'
import { gamesFor, gameById } from '../../lib/games.js'

const gameName = (id, lang) => {
  const g = gameById(id)
  if (!g) return id || ''
  return lang === 'en' ? (g.en || g.ar) : g.ar
}

// Only two-table games make sense here: one phone per table, two seats.
function versusGames(tenant) {
  return gamesFor(tenant).filter((g) => g.multiplayer && (g.minPlayers || 2) <= 2)
}

export default function TableVsTable({
  tenantId,
  tenant = null,
  lang = 'ar',
  table = null,
  player = null,
  // onOpenRoom(roomId, gameId, matchId) — the lead drops the guest onto the board.
  onOpenRoom = null,
}) {
  const brand = useBrand(tenant)
  const me = useMemo(() => resolvePlayer(player), [player])
  const myTableId = table?.id || ''

  const games = useMemo(() => versusGames(tenant), [tenant])
  const [gameId, setGameId] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  const venue = useWatch((cb) => watchVenueTables(tenantId, cb), [tenantId], { tables: [], error: null })
  const state = useWatch(
    (cb) => watchTableMatches(tenantId, myTableId, cb),
    [tenantId, myTableId],
    { matches: [], incoming: [], mine: [], error: null },
  )

  // The one match worth showing a scoreboard for: the newest that is not over.
  const activeMatch = useMemo(
    () => state.matches.find((m) => m.status === 'accepted' || m.status === 'playing')
      || state.matches.find((m) => m.status === 'done')
      || null,
    [state.matches],
  )

  // Borrow the room ONLY while a match is live, and only to show live numbers.
  const [room, setRoom] = useState(null)
  const liveRoomId = activeMatch && activeMatch.status !== 'done' ? activeMatch.roomId : ''
  useEffect(() => {
    if (!tenantId || !liveRoomId) { setRoom(null); return undefined }
    let alive = true
    const stop = watchRoom(tenantId, liveRoomId, (r) => { if (alive) setRoom(r) })
    return () => { alive = false; stop?.() }
  }, [tenantId, liveRoomId])

  // A finished room settles its match once. The guard is a ref, not state, so a
  // re-render mid-write cannot fire a second settle.
  const settled = useRef('')
  useEffect(() => {
    if (!room || room.status !== 'ended' || !activeMatch?.id) return
    if (activeMatch.status === 'done' || settled.current === activeMatch.id) return
    settled.current = activeMatch.id
    settleMatchFromRoom({ tid: tenantId, matchId: activeMatch.id, room })
  }, [room, activeMatch, tenantId])

  const others = useMemo(
    () => venue.tables.filter((t) => t.id !== myTableId),
    [venue.tables, myTableId],
  )

  const challenge = useCallback(async () => {
    if (!gameId || !target || busy) return
    setBusy('send'); setErr('')
    const other = others.find((t) => t.id === target)
    const r = await createMatch({
      tid: tenantId,
      gameId,
      tableA: { id: myTableId, label: table?.label || '' },
      tableB: { id: other?.id, label: other?.label || '' },
      player: me,
    })
    setBusy('')
    if (!r.ok) setErr(pick(lang, 'تعذّر إرسال التحدي. أعد المحاولة.', 'Could not send the challenge.'))
    else setTarget('')
  }, [gameId, target, busy, others, tenantId, myTableId, table, me, lang])

  // Accepting creates the room, so the two tables land on the same board with
  // one tap each and nobody has to read a code aloud across the room.
  const accept = useCallback(async (m) => {
    if (busy) return
    setBusy(m.id); setErr('')
    let roomId = ''
    try {
      roomId = await createRoom({
        tid: tenantId,
        gameId: m.gameId,
        table: { id: myTableId, label: table?.label || '' },
        player: { id: me.id, name: me.name },
        maxPlayers: 2,
        minPlayers: 2,
      })
    } catch (_) {
      setBusy('')
      setErr(pick(lang, 'تعذّر فتح غرفة اللعب. تحقّق من الاتصال.', 'Could not open the game room.'))
      return
    }
    const r = await acceptMatch({ tid: tenantId, matchId: m.id, player: me, roomId })
    setBusy('')
    if (!r.ok) { setErr(pick(lang, 'تعذّر قبول التحدي.', 'Could not accept.')); return }
    onOpenRoom?.(roomId, m.gameId, m.id)
  }, [busy, tenantId, myTableId, table, me, onOpenRoom, lang])

  const decline = useCallback(async (m) => {
    setBusy(m.id)
    await setMatchStatus({ tid: tenantId, matchId: m.id, status: 'declined' })
    setBusy('')
  }, [tenantId])

  // No table means no side to play for. Say that rather than pretending.
  if (!myTableId) {
    if (!state.matches.length) return null
    return (
      <Card brand={brand}>
        <Head icon="tables" title={pick(lang, 'طاولة ضد طاولة', 'Table versus table')} />
        <p className="sp-empty">
          {pick(
            lang,
            'لم نتعرّف على طاولتك، فلا نستطيع خوض مباراة باسمها. امسح رمز الطاولة ثم أعد المحاولة.',
            'We could not identify your table, so there is no side to play for. Scan the table code first.',
          )}
        </p>
      </Card>
    )
  }

  const mySide = activeMatch ? matchSideFor(activeMatch, myTableId) : null
  const winner = activeMatch ? matchWinner(activeMatch) : null
  const liveScore = (seat) => {
    const p = (room?.players || []).find((x) => x.seat === seat)
    return p ? Number(p.score) || 0 : null
  }
  const showA = activeMatch
    ? (room && liveScore(0) != null && activeMatch.status !== 'done' ? liveScore(0) : activeMatch.scoreA)
    : 0
  const showB = activeMatch
    ? (room && liveScore(1) != null && activeMatch.status !== 'done' ? liveScore(1) : activeMatch.scoreB)
    : 0

  return (
    <Card brand={brand}>
      <Head
        icon="tables"
        title={pick(lang, 'طاولة ضد طاولة', 'Table versus table')}
        right={<span className="sp-meta">{table?.label || ''}</span>}
      />

      {state.error || venue.error ? (
        <p className="sp-err">{pick(lang, 'تعذّر تحميل الطاولات أو المباريات.', 'Could not load tables or matches.')}</p>
      ) : null}
      {err ? <p className="sp-err">{err}</p> : null}

      {/* ---- the live / last scoreboard ---- */}
      {activeMatch ? (
        <>
          <div className="sp-vs">
            <div className={`sp-vs-side${winner === 'A' ? ' sp-win' : ''}${winner === 'B' ? ' sp-lose' : ''}`}>
              <div className="sp-vs-label">{activeMatch.tableA.label || pick(lang, 'طاولة', 'Table')}</div>
              <div className="sp-vs-score">{fmtNum(showA)}</div>
            </div>
            <div className="sp-vs-mid">{pick(lang, 'ضد', 'vs')}</div>
            <div className={`sp-vs-side${winner === 'B' ? ' sp-win' : ''}${winner === 'A' ? ' sp-lose' : ''}`}>
              <div className="sp-vs-label">{activeMatch.tableB.label || pick(lang, 'طاولة', 'Table')}</div>
              <div className="sp-vs-score">{fmtNum(showB)}</div>
            </div>
          </div>
          <p className="sp-sub">
            {gameName(activeMatch.gameId, lang)}
            {' · '}
            {activeMatch.status === 'done'
              ? (winner === 'draw'
                ? pick(lang, 'تعادل', 'Draw')
                : (winner === mySide ? pick(lang, 'فزتم', 'Your table won') : pick(lang, 'فازت الطاولة الأخرى', 'The other table won')))
              : (room ? pick(lang, 'جارية الآن', 'Live now') : pick(lang, 'بانتظار بدء الجولة', 'Waiting for the round to start'))}
          </p>
          {activeMatch.roomId && activeMatch.status !== 'done' && onOpenRoom ? (
            <div className="sp-actions">
              <button
                type="button"
                className="sp-btn sp-wide"
                onClick={() => onOpenRoom(activeMatch.roomId, activeMatch.gameId, activeMatch.id)}
              >
                <Icon name="play" size={15} />
                {pick(lang, 'ادخل اللوحة', 'Open the board')}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {/* ---- someone challenged us ---- */}
      {state.incoming.map((m) => (
        <article className="sp-tile" key={m.id} style={{ marginTop: 11 }}>
          <div className="sp-tile-top">
            <span className="sp-tile-name">
              {pick(lang, `${m.tableA.label || 'طاولة'} تتحدّاكم`, `${m.tableA.label || 'A table'} challenges you`)}
            </span>
            <span className="sp-tile-game">{gameName(m.gameId, lang)}</span>
          </div>
          <div className="sp-actions">
            <button type="button" className="sp-btn sp-sm" onClick={() => accept(m)} disabled={busy === m.id}>
              <Icon name="check" size={14} />
              {busy === m.id ? pick(lang, 'نجهّز الغرفة…', 'Opening…') : pick(lang, 'اقبل', 'Accept')}
            </button>
            <button type="button" className="sp-btn sp-ghost sp-sm" onClick={() => decline(m)} disabled={busy === m.id}>
              {pick(lang, 'لاحقاً', 'Not now')}
            </button>
          </div>
        </article>
      ))}

      {/* ---- our own pending challenge ---- */}
      {state.mine.map((m) => (
        <p className="sp-note" key={m.id}>
          {pick(
            lang,
            `أرسلتم تحدياً إلى ${m.tableB.label || 'طاولة'} في ${gameName(m.gameId, lang)} — بانتظار ردّهم.`,
            `Challenge sent to ${m.tableB.label || 'a table'} — waiting for them.`,
          )}
        </p>
      ))}

      {/* ---- start a new one ---- */}
      {!games.length ? (
        <p className="sp-empty">
          {pick(lang, 'لا توجد لعبة ثنائية مفعّلة في هذا المكان.', 'This venue has no two-player game enabled.')}
        </p>
      ) : !others.length ? (
        <p className="sp-empty">
          {venue.error
            ? pick(lang, 'تعذّر قراءة طاولات المكان.', 'Could not read the venue tables.')
            : pick(lang, 'لا توجد طاولة أخرى مسجّلة لتحدّيها.', 'No other table is registered to challenge.')}
        </p>
      ) : (
        <>
          <p className="sp-sub" style={{ marginTop: 11 }}>{pick(lang, 'اختر اللعبة', 'Pick the game')}</p>
          <div className="sp-chips">
            {games.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`sp-chip${gameId === g.id ? ' sp-on' : ''}`}
                onClick={() => setGameId(g.id)}
              >
                {lang === 'en' ? (g.en || g.ar) : g.ar}
              </button>
            ))}
          </div>
          <p className="sp-sub" style={{ marginTop: 11 }}>{pick(lang, 'اختر الطاولة', 'Pick the table')}</p>
          <div className="sp-chips">
            {others.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`sp-chip${target === t.id ? ' sp-on' : ''}`}
                onClick={() => setTarget(t.id)}
              >
                {t.label || t.id}
              </button>
            ))}
          </div>
          <div className="sp-actions">
            <button
              type="button"
              className="sp-btn sp-wide"
              onClick={challenge}
              disabled={!gameId || !target || busy === 'send'}
            >
              <Icon name="zap" size={15} />
              {busy === 'send' ? pick(lang, 'نرسل…', 'Sending…') : pick(lang, 'أرسل التحدي', 'Send the challenge')}
            </button>
          </div>
        </>
      )}
    </Card>
  )
}
