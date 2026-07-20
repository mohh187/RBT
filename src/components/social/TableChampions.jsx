// ===========================================================================
// أبطال الطاولة — the best results recorded ON THIS TABLE.
//
// THE HONEST LIMIT, STATED IN THE UI AND NOT ONLY IN A COMMENT
// ---------------------------------------------------------------------------
// A play record (tenants/{tid}/gamePlays) knows WHO played and WHAT they
// scored. It does not know WHERE. So a "table board" assembled from gamePlays
// would be the venue's board wearing this table's name — a lie a guest would
// believe, and would repeat out loud to the person sitting opposite them.
//
// What DOES carry a table is a game room: rooms hold tableId and a score per
// seat, and their player ids are the same device key a play uses. So this board
// is built from the rounds actually played at this table.
//
// When that yields nothing — a new table, a venue whose guests only play solo,
// or a guest who never scanned a table code — the component says exactly that
// and shows the venue board UNDER ITS OWN NAME. It never relabels one board as
// the other.
// ===========================================================================
import { useMemo } from 'react'
import Icon from '../Icon.jsx'
import { Card, Head, BoardRow, useBrand, useWatch, pick } from './parts.jsx'
import {
  watchTableRooms,
  watchVenueBoard,
  tableChampions,
  resolvePlayer,
  fmtNum,
} from '../../lib/socialPlay.js'
import { gameById } from '../../lib/games.js'

const TOP = 7

export default function TableChampions({
  tenantId,
  tenant = null,
  lang = 'ar',
  table = null,
  player = null,
  // Narrow the board to one game. Empty means "every game played here".
  gameId = '',
  // Fall back to the venue board when this table has no history of its own.
  // Off makes the component disappear instead, for a dense screen.
  allowVenueFallback = true,
}) {
  const brand = useBrand(tenant)
  const me = useMemo(() => resolvePlayer(player), [player])
  const tableId = table?.id || ''

  const tableRooms = useWatch(
    (cb) => (tableId ? watchTableRooms(tenantId, tableId, cb) : cb({ rooms: [], error: 'no-table' })),
    [tenantId, tableId],
    { rooms: [], error: null },
  )

  const champs = useMemo(
    () => tableChampions(tableRooms.rooms, { gameId }),
    [tableRooms.rooms, gameId],
  )

  const resolved = champs.length > 0
  const venue = useWatch(
    (cb) => ((!resolved && allowVenueFallback) ? watchVenueBoard(tenantId, '', cb) : cb({ rows: [], error: null })),
    [tenantId, resolved, allowVenueFallback],
    { rows: [], error: null },
  )

  // Nothing true to show at all.
  if (!resolved && (!allowVenueFallback || !venue.rows.length)) {
    if (tableRooms.error && tableRooms.error !== 'no-table') {
      return (
        <Card brand={brand}>
          <Head icon="star" title={pick(lang, 'أبطال الطاولة', 'This table’s champions')} />
          <p className="sp-err">{pick(lang, 'تعذّر قراءة نتائج هذه الطاولة.', 'Could not read this table’s results.')}</p>
        </Card>
      )
    }
    return null
  }

  const game = gameId ? gameById(gameId) : null
  const rows = resolved ? champs.slice(0, TOP) : venue.rows.slice(0, TOP)

  return (
    <Card brand={brand}>
      <Head
        icon="star"
        title={resolved
          ? pick(lang, 'أبطال هذه الطاولة', 'This table’s champions')
          : pick(lang, 'أبطال المكان', 'The venue’s champions')}
        right={resolved && table?.label ? <span className="sp-meta">{table.label}</span> : null}
      />

      {/* The reason the guest is looking at the venue board, said plainly. */}
      {!resolved ? (
        <p className="sp-sub">
          {tableId
            ? pick(
              lang,
              'لا نملك نتائج مسجّلة على هذه الطاولة بعد، فهذه لوحة المكان كله.',
              'No results are recorded on this table yet, so this is the whole venue’s board.',
            )
            : pick(
              lang,
              'لم نتعرّف على طاولتك، فلا نستطيع بناء لوحة خاصة بها. هذه لوحة المكان كله.',
              'We could not identify your table, so this is the whole venue’s board.',
            )}
        </p>
      ) : game ? (
        <p className="sp-sub">{lang === 'en' ? (game.en || game.ar) : game.ar}</p>
      ) : null}

      <div className="sp-board">
        {rows.map((r) => (
          <BoardRow
            key={r.deviceId}
            rank={r.rank}
            name={r.name}
            score={r.score}
            meta={resolved && r.wins > 0
              ? pick(lang, `${fmtNum(r.wins)} فوز`, `${fmtNum(r.wins)} wins`)
              : ''}
            me={r.deviceId === me.id}
          />
        ))}
      </div>

      {resolved ? (
        <p className="sp-note">
          <Icon name="tables" size={12} />
          {' '}
          {pick(
            lang,
            `من ${fmtNum(champs.length)} لاعباً سجّلوا نتائج على هذه الطاولة.`,
            `From ${fmtNum(champs.length)} players who scored at this table.`,
          )}
        </p>
      ) : null}
    </Card>
  )
}
