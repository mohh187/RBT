// «لوحة صدارة صيادي الشهر» — the monthly board for the WaitGame fishing round.
// Podium for the top three, then a ranked list; this device's row is highlighted
// and pinned at the bottom when it falls outside the visible top. Scores are
// per-device (localStorage best is the source), one row per device per month.
import { useEffect, useRef, useState } from 'react'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { Spinner } from './ui.jsx'
import { fmtNum } from '../lib/format.js'
import { submitScore, watchTopScores, myRank, currentMonth, cleanName, TOP_N } from '../lib/leaderboard.js'

const T = {
  ar: {
    title: 'لوحة صدارة صيادي الشهر',
    monthNote: `تُصفّر اللوحة مع بداية كل شهر — الأشهر السابقة تبقى محفوظة. تُعرض أعلى ${TOP_N} نتيجة.`,
    empty: 'لا توجد نتائج هذا الشهر بعد — كن أول صيّاد على اللوحة.',
    errorTitle: 'تعذّر تحميل اللوحة',
    errorHint: 'تحقّق من الاتصال ثم أعد فتح اللوحة.',
    you: 'أنت',
    yourRank: 'ترتيبك',
    yourScore: 'نتيجتك',
    points: 'نقطة',
    namePh: 'اسمك على اللوحة',
    save: 'حفظ الاسم',
    saved: 'تم حفظ اسمك',
    saving: 'جاري الحفظ',
    anon: 'صيّاد مجهول',
    noScore: 'العب جولة أولاً حتى تظهر على اللوحة.',
    outside: `ترتيبك خارج أفضل ${TOP_N}`,
    of: 'من',
    players: 'لاعباً',
    close: 'إغلاق',
  },
  en: {
    title: 'Anglers of the month',
    monthNote: `The board resets at the start of each month — past months stay saved. Top ${TOP_N} shown.`,
    empty: 'No scores yet this month — be the first angler on the board.',
    errorTitle: 'Could not load the board',
    errorHint: 'Check your connection, then reopen the board.',
    you: 'You',
    yourRank: 'Your rank',
    yourScore: 'Your score',
    points: 'pts',
    namePh: 'Your board name',
    save: 'Save name',
    saved: 'Name saved',
    saving: 'Saving',
    anon: 'Anonymous angler',
    noScore: 'Play a round first to appear on the board.',
    outside: `You are outside the top ${TOP_N}`,
    of: 'of',
    players: 'players',
    close: 'Close',
  },
}

function Podium({ rows, deviceId, t, lang }) {
  // Visual order: silver, gold (raised), bronze. `order` keeps that layout in
  // both directions without reordering the semantic (rank-sorted) array.
  const order = [1, 0, 2]
  return (
    <div className="lb-podium">
      {order.map((idx) => {
        const r = rows[idx]
        if (!r) return <div key={idx} className="lb-pod lb-pod-empty" style={{ order: idx }} aria-hidden="true" />
        const rank = idx + 1
        const mine = r.deviceId === deviceId
        return (
          <div key={r.id} className={`lb-pod lb-pod-${rank}${mine ? ' is-me' : ''}`} style={{ order: idx }}>
            <span className="lb-medal" aria-hidden="true">
              {rank === 1 ? <Icon name="award" size={18} /> : <b>{rank}</b>}
            </span>
            <span className="lb-pod-name" title={r.name || t.anon}>{r.name || t.anon}{mine ? ` · ${t.you}` : ''}</span>
            <span className="lb-pod-score">{fmtNum(r.score, lang)}</span>
            <span className="lb-pod-base"><span className="lb-pod-rank">{rank}</span></span>
          </div>
        )
      })}
    </div>
  )
}

export default function Leaderboard({ open, onClose, tenantId, lang = 'ar', myScore = 0, deviceId = '' }) {
  const ar = lang !== 'en'
  const t = ar ? T.ar : T.en
  const [board, setBoard] = useState({ scores: [], top: [], error: null })
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const sentRef = useRef('')
  const month = currentMonth()

  // Live board.
  useEffect(() => {
    if (!open || !tenantId) return undefined
    setLoading(true)
    const stop = watchTopScores(tenantId, month, (res) => {
      setBoard(res)
      setLoading(false)
    })
    return stop
  }, [open, tenantId, month])

  // Push this device's best once per (open, score) — submitScore itself refuses
  // to write anything that is not an improvement.
  useEffect(() => {
    if (!open || !tenantId || !deviceId || !(myScore > 0)) return
    const key = `${tenantId}:${month}:${myScore}`
    if (sentRef.current === key) return
    sentRef.current = key
    submitScore(tenantId, { score: myScore, deviceId, name: '' }).catch(() => {})
  }, [open, tenantId, deviceId, myScore, month])

  const mine = myRank(board.scores, deviceId)

  // Seed the name field from the saved row once it arrives.
  useEffect(() => {
    if (mine?.entry?.name && !name) setName(mine.entry.name)
  }, [mine?.entry?.name, name])

  const saveName = async (e) => {
    e.preventDefault()
    const nm = cleanName(name)
    if (!nm || !tenantId || !deviceId) return
    setSaving(true)
    setNote('')
    try {
      await submitScore(tenantId, { score: mine?.entry?.score || myScore || 0, deviceId, name: nm })
      setNote(t.saved)
    } catch (_) {
      setNote(t.errorTitle)
    }
    setSaving(false)
  }

  const rest = board.top.slice(3)
  const outside = mine && mine.rank > TOP_N

  return (
    <Sheet open={open} onClose={onClose} title={t.title} tall className="lb-sheet">
      {loading ? (
        <div className="lb-state"><Spinner /></div>
      ) : board.error ? (
        <div className="lb-state lb-state-err">
          <Icon name="warning" size={22} />
          <strong>{t.errorTitle}</strong>
          <span className="lb-faint">{t.errorHint}</span>
        </div>
      ) : !board.scores.length ? (
        <div className="lb-state">
          <Icon name="award" size={26} />
          <strong>{t.empty}</strong>
          <span className="lb-faint">{myScore > 0 ? `${t.yourScore}: ${fmtNum(myScore, lang)} ${t.points}` : t.noScore}</span>
        </div>
      ) : (
        <>
          <Podium rows={board.top} deviceId={deviceId} t={t} lang={lang} />

          {rest.length > 0 && (
            <ol className="lb-list" start={4}>
              {rest.map((r, i) => {
                const rank = i + 4
                const me = r.deviceId === deviceId
                return (
                  <li key={r.id} className={`lb-row${me ? ' is-me' : ''}`}>
                    <span className="lb-rank">{rank}</span>
                    <span className="lb-name">{r.name || t.anon}{me ? ` · ${t.you}` : ''}</span>
                    <span className="lb-score">{fmtNum(r.score, lang)}</span>
                  </li>
                )
              })}
            </ol>
          )}

          {outside && (
            <div className="lb-pinned">
              <span className="lb-pinned-label">{t.outside}</span>
              <div className="lb-row is-me">
                <span className="lb-rank">{mine.rank}</span>
                <span className="lb-name">{mine.entry.name || t.anon} · {t.you}</span>
                <span className="lb-score">{fmtNum(mine.entry.score, lang)}</span>
              </div>
            </div>
          )}

          {mine && !outside && (
            <p className="lb-mine-line">{t.yourRank}: <b>{mine.rank}</b> {t.of} {mine.total} {t.players}</p>
          )}
        </>
      )}

      {deviceId && (myScore > 0 || mine) && (
        <form className="lb-nameform" onSubmit={saveName}>
          <input
            className="input lb-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.namePh}
            maxLength={24}
            aria-label={t.namePh}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !cleanName(name)}>
            {saving ? t.saving : t.save}
          </button>
        </form>
      )}
      {note && <p className="lb-note-msg">{note}</p>}
      <p className="lb-monthnote">{t.monthNote}</p>
    </Sheet>
  )
}
