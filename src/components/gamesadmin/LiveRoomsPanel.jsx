// «الغرف المباشرة» — the multiplayer tables running in the venue right now.
//
// This is floor information, not analytics: which table has a board open, which
// game, who is seated, and how long it has been going. A room whose players all
// walked away sits in 'playing' forever (nothing on a guest phone can close it
// once the phones are gone), so staff can end one from here.
//
// Reads tenants/{tid}/rooms live, bounded, and filtered to the two statuses that
// mean "a table is occupied". Ended rooms are history and are not listed.
import { useEffect, useMemo, useState } from 'react'
import { collection, query, where, limit, onSnapshot } from 'firebase/firestore'
import Icon from '../Icon.jsx'
import { Spinner } from '../ui.jsx'
import { db, firebaseReady } from '../../lib/firebase.js'
import { gameById } from '../../lib/games.js'
import { endRoom, isConnected, DISCONNECT_MS } from '../../lib/gameRoom.js'
import { fmtInt, elapsedText, dateTime, MAX_ROOMS } from './engine.jsx'

const num = (v, f = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : f
}

const LIVE = ['lobby', 'playing']

const gameName = (id, ar) => {
  const g = gameById(id)
  return g ? (ar ? g.ar : (g.en || g.ar)) : (id || (ar ? 'لعبة غير معروفة' : 'unknown'))
}

export default function LiveRoomsPanel({ ar = true, tenantId, canEdit = false }) {
  const [rooms, setRooms] = useState(null)
  const [err, setErr] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [working, setWorking] = useState('')
  const [confirmId, setConfirmId] = useState('')

  // Durations on this screen must keep moving without re-reading Firestore.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 20000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    if (!firebaseReady || !tenantId) {
      setRooms([])
      setErr(firebaseReady ? '' : 'unavailable')
      return undefined
    }
    setRooms(null); setErr('')
    const col = collection(db, 'tenants', tenantId, 'rooms')
    let fallback = null

    const emit = (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => LIVE.includes(r.status))
        .sort((a, b) => num(b.updatedAt) - num(a.updatedAt))
      setRooms(rows)
      setErr('')
    }

    // A single-field `in` filter needs no composite index. If a rule denies the
    // shaped query anyway, fall back to an unfiltered bounded read rather than
    // leaving the panel spinning.
    const unsub = onSnapshot(
      query(col, where('status', 'in', LIVE), limit(MAX_ROOMS)),
      emit,
      (e) => {
        const code = String(e?.code || '')
        if (code.includes('permission-denied')) { setRooms([]); setErr('permission'); return }
        try {
          fallback = onSnapshot(query(col, limit(MAX_ROOMS)), emit, (e2) => {
            setRooms([]); setErr(String(e2?.code || e2?.message || 'error'))
          })
        } catch (_) { setRooms([]); setErr(code || 'error') }
      },
    )
    return () => {
      try { unsub() } catch (_) { /* already gone */ }
      try { if (fallback) fallback() } catch (_) { /* already gone */ }
    }
  }, [tenantId])

  const rows = rooms || []
  const playing = useMemo(() => rows.filter((r) => r.status === 'playing').length, [rows])

  const close = async (room) => {
    if (!canEdit || working) return
    setWorking(room.id)
    try {
      // endRoom swallows its own failures and reports false rather than
      // throwing, so a silent no-op is the failure mode to guard against: the
      // room would simply stay on screen with no explanation.
      const ok = await endRoom({ tid: tenantId, roomId: room.id })
      if (!ok) { setErr('end-failed'); return }
      setConfirmId('')
    } catch (e) {
      setErr(String(e?.code || e?.message || 'error'))
    } finally { setWorking('') }
  }

  return (
    <div className="ga-stack">
      <div className="ga-card">
        <div className="ga-card-t">
          <Icon name="shapes" size={15} /> {ar ? 'الغرف المفتوحة الآن' : 'Open rooms'}
          <span className="ga-grow" />
          <span className="ga-of ga-num">
            {fmtInt(rows.length)} {ar ? 'غرفة' : 'rooms'} · {fmtInt(playing)} {ar ? 'جارية' : 'playing'}
          </span>
        </div>
        <p className="ga-hint">
          {ar
            ? 'مباشر. تُعرض الغرف في وضع الانتظار أو اللعب فقط؛ الغرف المنتهية تاريخ ولا تُدرج هنا.'
            : 'Live. Only lobby/playing rooms are listed.'}
        </p>
      </div>

      {rooms === null && !err && <div className="ga-card"><div className="ga-loading"><Spinner /></div></div>}

      {err && (
        <div className="ga-warn">
          <Icon name="warning" size={15} />
          <span>
            {err === 'permission'
              ? (ar ? 'لا تملك صلاحية قراءة غرف هذا المكان.' : 'No permission to read rooms.')
              : err === 'unavailable'
                ? (ar ? 'الاتصال بقاعدة البيانات غير مُهيَّأ في هذه البيئة.' : 'Database not configured.')
                : err === 'end-failed'
                  ? (ar ? 'لم تُغلق الغرفة — قد تكون أُغلقت من جهاز آخر، أو منعت القواعد الكتابة. حدّث الصفحة ثم أعد المحاولة.' : 'The room was not closed — it may already be ended, or the write was denied.')
                  : `${ar ? 'تعذّرت قراءة الغرف: ' : 'Could not read rooms: '}${err}`}
          </span>
        </div>
      )}

      {rooms !== null && !err && rows.length === 0 && (
        <div className="ga-card">
          <p className="ga-empty-t">{ar ? 'لا غرفة مفتوحة الآن' : 'No open rooms'}</p>
          <p className="ga-hint">
            {ar
              ? 'عندما يفتح ضيف لعبة جماعية (ليدو، شطرنج، دومينو، وِست، جكارو) تظهر غرفته هنا لحظياً: الطاولة، اللعبة، من جلس فيها، ومنذ متى.'
              : 'A guest opening a party game appears here instantly.'}
          </p>
        </div>
      )}

      {rows.map((r) => {
        const seated = Array.isArray(r.players) ? r.players : []
        const live = seated.filter((p) => isConnected(p, now)).length
        const started = num(r.createdAt)
        return (
          <div key={r.id} className="ga-card ga-roomcard">
            <div className="ga-card-t">
              <span className={`ga-pill is-${r.status === 'playing' ? 'running' : 'scheduled'}`}>
                {r.status === 'playing' ? (ar ? 'جارية' : 'Playing') : (ar ? 'بانتظار اللاعبين' : 'Lobby')}
              </span>
              <strong>{gameName(r.gameId, ar)}</strong>
              <span className="ga-grow" />
              <span className="ga-of ga-num">{ar ? 'رمز' : 'Code'} {r.id}</span>
            </div>

            <div className="ga-figs">
              <div className="ga-fig">
                <span className="ga-fig-l">{ar ? 'الطاولة' : 'Table'}</span>
                <strong className="ga-fig-v">
                  {r.tableLabel || (r.tableId ? <span className="ga-num">{r.tableId}</span> : <span className="ga-of">{ar ? 'بلا طاولة' : 'none'}</span>)}
                </strong>
              </div>
              <div className="ga-fig">
                <span className="ga-fig-l">{ar ? 'منذ' : 'Open for'}</span>
                <strong className="ga-fig-v ga-num">{elapsedText(started, now)}</strong>
                <span className="ga-fig-s ga-num">{dateTime(started)}</span>
              </div>
              <div className="ga-fig">
                <span className="ga-fig-l">{ar ? 'المقاعد' : 'Seats'}</span>
                <strong className="ga-fig-v ga-num">{fmtInt(seated.length)} / {fmtInt(r.maxPlayers)}</strong>
                <span className="ga-fig-s ga-num">{fmtInt(live)} {ar ? 'متصل الآن' : 'connected'}</span>
              </div>
              <div className="ga-fig">
                <span className="ga-fig-l">{ar ? 'آخر حركة' : 'Last move'}</span>
                <strong className="ga-fig-v ga-num">{elapsedText(num(r.updatedAt), now)}</strong>
              </div>
            </div>

            <div className="ga-seats">
              {seated.length === 0 && <span className="ga-of">{ar ? 'لا أحد جالس' : 'nobody seated'}</span>}
              {seated.map((p) => (
                <span key={p.id || p.seat} className={`ga-seat${isConnected(p, now) ? ' is-live' : ''}`}>
                  <Icon name="user" size={13} />
                  <span>{p.name || (ar ? 'ضيف' : 'Guest')}</span>
                  <span className="ga-num">#{fmtInt(num(p.seat) + 1)}</span>
                  {r.hostId === p.id && <span className="ga-tag ga-tag-sm">{ar ? 'المضيف' : 'Host'}</span>}
                  {!isConnected(p, now) && <span className="ga-thin">{ar ? 'منقطع' : 'away'}</span>}
                </span>
              ))}
            </div>

            {seated.length > 0 && live === 0 && (
              <p className="ga-hint">
                {ar
                  ? `لا أحد من الجالسين أرسل إشارة حياة منذ أكثر من ${fmtInt(Math.round(DISCONNECT_MS / 1000))} ثانية — غالباً غادروا الطاولة وتركوا الغرفة مفتوحة.`
                  : 'Nobody has checked in recently — the table was probably abandoned.'}
              </p>
            )}

            {canEdit && (
              <div className="ga-actions">
                {confirmId === r.id ? (
                  <>
                    <span className="ga-hint">
                      {ar
                        ? 'سيُغلق اللوح لكل من في الغرفة فوراً. لا يمكن استئناف الجولة نفسها بعدها.'
                        : 'The board closes for everyone immediately and cannot be resumed.'}
                    </span>
                    <button type="button" className="ga-btn is-danger" disabled={working === r.id} onClick={() => close(r)}>
                      <Icon name="check" size={14} /> {ar ? 'تأكيد الإنهاء' : 'Confirm'}
                    </button>
                    <button type="button" className="ga-btn" disabled={working === r.id} onClick={() => setConfirmId('')}>
                      {ar ? 'تراجع' : 'Cancel'}
                    </button>
                  </>
                ) : (
                  <button type="button" className="ga-btn" onClick={() => setConfirmId(r.id)}>
                    <Icon name="stop" size={14} /> {ar ? 'إنهاء الغرفة' : 'End room'}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {rows.length >= MAX_ROOMS && (
        <div className="ga-warn">
          <Icon name="warning" size={15} />
          <span>
            {ar
              ? `تُعرض أول ${fmtInt(MAX_ROOMS)} غرفة فقط — قد تكون هناك غرف مفتوحة غير ظاهرة هنا.`
              : `Showing the first ${MAX_ROOMS} rooms only.`}
          </span>
        </div>
      )}
    </div>
  )
}
