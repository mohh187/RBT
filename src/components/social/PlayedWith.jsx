// ===========================================================================
// خريطة اللاعبين — the people this device has actually played with, and which
// of them is in the venue right now.
//
// ---------------------------------------------------------------------------
// THE PRIVACY BOUNDARY (this is the whole design, not a caveat at the end)
// ---------------------------------------------------------------------------
// • A person appears here ONLY if they shared a game room or a table match with
//   THIS device. There is no venue-wide list of guests behind this component
//   and no query in it can produce one: every source is filtered through
//   `peersFromRooms` / `peersFromMatches`, both of which return an empty list
//   when this device is not in the record.
//
// • The only field shown is the first name that person typed into the room
//   themselves. Phone numbers exist on room player records and are dropped in
//   socialPlay.publicPeer() — this component never sees one.
//
// • «هنا الآن» means exactly one thing: that device appears in a room in THIS
//   venue whose document moved today. It is not a table number, not a seat, not
//   a position in the room, and it expires at midnight on its own.
//
// If a guest could learn something about a stranger from this screen, it would
// be a bug. They can only learn about people who chose to sit and play with
// them.
// ===========================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import { Card, Head, Initial, useBrand, useWatch, pick } from './parts.jsx'
import {
  watchTodayRooms,
  fetchRememberedRooms,
  rememberedRoomIds,
  fetchMyMatches,
  peersFromRooms,
  peersFromMatches,
  mergePeers,
  presentPeerIds,
  resolvePlayer,
  fmtNum,
} from '../../lib/socialPlay.js'
import { gameById } from '../../lib/games.js'

const MAX_SHOWN = 8

const gameName = (id, lang) => {
  const g = gameById(id)
  if (!g) return ''
  return lang === 'en' ? (g.en || g.ar) : g.ar
}

export default function PlayedWith({
  tenantId,
  tenant = null,
  lang = 'ar',
  table = null,
  player = null,
  // onRematch({ peer, gameId }) — the lead opens a room / lobby for the two.
  onRematch = null,
}) {
  const brand = useBrand(tenant)
  const me = useMemo(() => resolvePlayer(player), [player])

  // Live: rooms in this venue that moved today. Doubles as the presence signal
  // and as auto-discovery of the people met today, with no bookkeeping.
  const today = useWatch(
    (cb) => watchTodayRooms(tenantId, cb),
    [tenantId],
    { rooms: [], error: null },
  )

  // One-shot: the older rooms this device remembers joining, plus its matches.
  const [history, setHistory] = useState({ rooms: [], matches: [], loaded: false })
  useEffect(() => {
    if (!tenantId) return undefined
    let alive = true
    const ids = rememberedRoomIds(tenantId)
    Promise.all([
      ids.length ? fetchRememberedRooms(tenantId, ids) : Promise.resolve([]),
      fetchMyMatches(tenantId, me.id),
    ]).then(([rooms, matches]) => {
      if (alive) setHistory({ rooms, matches, loaded: true })
    })
    return () => { alive = false }
  }, [tenantId, me.id])

  const peers = useMemo(() => mergePeers(
    peersFromRooms([...today.rooms, ...history.rooms], me.id),
    peersFromMatches(history.matches, me.id),
  ), [today.rooms, history.rooms, history.matches, me.id])

  const hereNow = useMemo(() => presentPeerIds(today.rooms), [today.rooms])

  const ranked = useMemo(() => {
    const withPresence = peers.map((p) => ({ ...p, here: hereNow.has(p.id) }))
    // Present people first — the whole point is a rematch you can act on now.
    return withPresence.sort((a, b) => (b.here ? 1 : 0) - (a.here ? 1 : 0) || b.lastAt - a.lastAt)
  }, [peers, hereNow])

  const rematch = useCallback((p) => {
    onRematch?.({ peer: { id: p.id, name: p.name }, gameId: p.lastGameId || '' })
  }, [onRematch])

  // Nobody has played with this device yet. That is not an error and not a
  // screen worth occupying.
  if (!ranked.length) return null

  const present = ranked.filter((p) => p.here)
  const shown = ranked.slice(0, MAX_SHOWN)

  return (
    <Card brand={brand}>
      <Head
        icon="customers"
        title={pick(lang, 'لعبت معهم', 'People you have played with')}
        right={present.length
          ? <span className="sp-meta">{pick(lang, `${fmtNum(present.length)} هنا`, `${fmtNum(present.length)} here`)}</span>
          : null}
      />

      {today.error ? (
        <p className="sp-err">
          {pick(lang, 'تعذّر معرفة من في المكان الآن. القائمة أدناه من ذاكرة جهازك.', 'Could not check who is here now. The list below is from this device.')}
        </p>
      ) : null}

      <div className="sp-list">
        {shown.map((p) => (
          <div className={`sp-peer${p.here ? ' sp-here' : ''}`} key={p.id}>
            <Initial name={p.name} />
            <div className="sp-peer-body">
              <div className="sp-peer-name">{p.name}</div>
              <div className="sp-peer-sub">
                {p.here
                  ? pick(lang, `${p.name} هنا الآن`, `${p.name} is here now`)
                  : (() => {
                    const g = gameName(p.lastGameId, lang)
                    const times = pick(lang, `${fmtNum(p.games)} جولة معاً`, `${fmtNum(p.games)} rounds together`)
                    return g ? `${times} · ${g}` : times
                  })()}
              </div>
            </div>
            {onRematch && p.here ? (
              <button type="button" className="sp-btn sp-sm" onClick={() => rematch(p)}>
                <Icon name="repeat" size={14} />
                {pick(lang, 'أعِدها', 'Rematch')}
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <p className="sp-note">
        {pick(
          lang,
          'نعرض فقط من شاركك غرفة لعب من قبل، وبالاسم الأول الذي كتبه بنفسه. «هنا الآن» تعني أنه لعب في هذا المكان اليوم — لا أكثر.',
          'Only people who shared a room with you, under the first name they typed. “Here now” means they played in this venue today — nothing more.',
        )}
      </p>

      {table?.label && present.length ? (
        <p className="sp-note">{pick(lang, `أنت على ${table.label}`, `You are at ${table.label}`)}</p>
      ) : null}
    </Card>
  )
}
