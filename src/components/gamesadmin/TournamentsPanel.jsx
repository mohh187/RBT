// «البطولات» — create a competition, watch it score itself, freeze the result.
//
// The standings on this screen are computed by src/lib/tournaments.js from the
// venue's own gamePlays inside the tournament's own window. That is why this
// panel fetches its plays SEPARATELY from the rest of the page: a tournament's
// dates have nothing to do with the period picker at the top, and scoring a
// competition over the wrong window would be worse than showing nothing.
//
// Four honesty rules are enforced here rather than in CSS:
//   • no qualifying play  -> «لا نتائج بعد», and no table is drawn at all —
//     but ONLY when the read behind it provably spanned the tournament window.
//     The play read pages the window until it is exhausted, so that proof is the
//     normal case; it fails only when the window holds more plays than the hard
//     safety ceiling, or when the read itself failed. That short slice must never
//     be printed as «لا جولات مؤهلة»; it is reported as a short read, together
//     with the one action that fixes it — a shorter window.
//   • a prize is only ever the text the venue typed. Nothing is suggested.
//   • «إنهاء وإعلان الفائزين» freezes exactly the rows on screen. If that is an
//     empty list, the tournament closes with an empty list and says so.
//   • that button is BLOCKED whenever the read did not cover the window. A wrong
//     announced winner is worse for a venue's guests than no announcement, and
//     the freeze is permanent unless a manager notices and reopens.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import { Spinner } from '../ui.jsx'
import { GAMES, gameById } from '../../lib/games.js'
import {
  TOURNAMENT_MODES, PRIZE_KINDS, STATUS_AR,
  watchTournaments, saveTournament, deleteTournament, standings, finalize, reopen,
  newTournament, normalizeTournament, validateTournament, statusOf, modeInfo,
  toDayInput, fromDayInput, valueLabel, MAX_WINNERS,
} from '../../lib/tournaments.js'
import { fetchPlays, fmtInt, dateTime, dayStamp } from './engine.jsx'

const num = (v, f = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : f
}

const maskPhone = (p) => {
  const s = String(p || '')
  return s.length > 6 ? `${s.slice(0, 5)}***${s.slice(-3)}` : s
}

const shortDevice = (d) => {
  const s = String(d || '')
  return s.length > 8 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s
}

const rowName = (r, ar) => r.name || (r.phone ? maskPhone(r.phone) : `${ar ? 'ضيف' : 'Guest'} · ${shortDevice(r.deviceId)}`)

const gameName = (id, ar) => {
  if (!id || id === 'any') return ar ? 'كل الألعاب' : 'All games'
  const g = gameById(id)
  return g ? (ar ? g.ar : (g.en || g.ar)) : id
}

// The venue's prize, rendered from the venue's own words. `kind` only decides
// which unit is appended — it never generates a prize that was not typed.
function prizeText(prize, ar) {
  const p = prize || {}
  const label = String(p.label || '').trim()
  const v = num(p.value)
  if (p.kind === 'discount' && v > 0) {
    return `${ar ? 'خصم' : ''} ${v.toLocaleString('ar-SA-u-nu-latn')}٪${label ? ` — ${label}` : ''}`.trim()
  }
  if (p.kind === 'points' && v > 0) {
    return `${v.toLocaleString('ar-SA-u-nu-latn')} ${ar ? 'نقطة ولاء' : 'points'}${label ? ` — ${label}` : ''}`
  }
  return label
}

// ---------------------------------------------------------------------------
// editor
// ---------------------------------------------------------------------------
function Editor({ ar, draft, onChange, onSave, onCancel, saving }) {
  const problems = validateTournament(draft)
  const set = (patch) => onChange({ ...draft, ...patch })
  const setPrize = (patch) => onChange({ ...draft, prize: { ...(draft.prize || {}), ...patch } })
  const kind = draft.prize?.kind || 'custom'
  const needsValue = kind === 'discount' || kind === 'points'

  return (
    <div className="ga-card">
      <div className="ga-card-t">
        <Icon name="award" size={15} /> {draft.createdAtExisting ? (ar ? 'تعديل بطولة' : 'Edit') : (ar ? 'بطولة جديدة' : 'New tournament')}
      </div>

      <label className="ga-field">
        <span>{ar ? 'اسم البطولة' : 'Name'}</span>
        <input
          className="ga-input" type="text" maxLength={60} value={draft.name || ''}
          placeholder={ar ? 'مثال: بطولة نهاية الأسبوع' : 'e.g. Weekend cup'}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>

      <div className="ga-two">
        <label className="ga-field">
          <span>{ar ? 'اللعبة' : 'Game'}</span>
          <select className="ga-input" value={draft.gameId || 'any'} onChange={(e) => set({ gameId: e.target.value })}>
            <option value="any">{ar ? 'كل الألعاب' : 'All games'}</option>
            {GAMES.map((g) => <option key={g.id} value={g.id}>{ar ? g.ar : (g.en || g.ar)}</option>)}
          </select>
        </label>
        <label className="ga-field">
          <span>{ar ? 'طريقة الترتيب' : 'Mode'}</span>
          <select className="ga-input" value={draft.mode || 'highscore'} onChange={(e) => set({ mode: e.target.value })}>
            {TOURNAMENT_MODES.map((m) => <option key={m.id} value={m.id}>{ar ? m.ar : m.en}</option>)}
          </select>
        </label>
      </div>
      <p className="ga-hint">{modeInfo(draft.mode).howAr}</p>

      <div className="ga-two">
        <label className="ga-field">
          <span>{ar ? 'من تاريخ' : 'From'}</span>
          <input
            className="ga-input" type="date" value={toDayInput(draft.from)}
            onChange={(e) => set({ from: fromDayInput(e.target.value, false) })}
          />
        </label>
        <label className="ga-field">
          <span>{ar ? 'إلى تاريخ' : 'To'}</span>
          <input
            className="ga-input" type="date" value={toDayInput(draft.to)}
            onChange={(e) => set({ to: fromDayInput(e.target.value, true) })}
          />
        </label>
      </div>

      <div className="ga-two">
        <label className="ga-field">
          <span>{ar ? 'نوع الجائزة' : 'Prize kind'}</span>
          <select className="ga-input" value={kind} onChange={(e) => setPrize({ kind: e.target.value })}>
            {PRIZE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.ar}</option>)}
          </select>
        </label>
        {needsValue && (
          <label className="ga-field">
            <span>{kind === 'discount' ? (ar ? 'نسبة الخصم' : 'Discount %') : (ar ? 'عدد النقاط' : 'Points')}</span>
            <input
              className="ga-input ga-num" type="number" inputMode="numeric" min="1"
              max={kind === 'discount' ? 100 : undefined}
              value={draft.prize?.value || ''}
              onChange={(e) => setPrize({ value: e.target.value })}
            />
          </label>
        )}
      </div>

      <label className="ga-field">
        <span>{ar ? 'الجائزة كما تكتبها للضيف' : 'Prize, in your words'}</span>
        <input
          className="ga-input" type="text" maxLength={80} value={draft.prize?.label || ''}
          placeholder={ar ? 'مثال: قهوة مجانية لمدة أسبوع' : 'e.g. Free coffee for a week'}
          onChange={(e) => setPrize({ label: e.target.value })}
        />
      </label>
      <p className="ga-hint">
        {ar
          ? 'الجائزة تُعرض بنصّها كما كتبته بالضبط. النظام لا يقترح جوائز ولا يعِد الضيف بشيء لم تكتبه أنت.'
          : 'The prize is shown verbatim. Nothing is generated or promised on your behalf.'}
      </p>

      <label className="ga-check">
        <input type="checkbox" checked={draft.active !== false} onChange={(e) => set({ active: e.target.checked })} />
        <span>{ar ? 'مفعّلة' : 'Active'}</span>
      </label>
      <label className="ga-check">
        <input type="checkbox" checked={draft.autoAnnounce === true} onChange={(e) => set({ autoAnnounce: e.target.checked })} />
        <span>{ar ? 'وسم للإعلان التلقائي' : 'Flag for auto-announce'}</span>
      </label>
      <p className="ga-hint">
        {ar
          ? 'هذا الخيار يُحفظ كوسم فقط — لا يُرسل النظام أي رسالة أو إشعار تلقائي اليوم. الإعلان يتم بضغطك على «إنهاء وإعلان الفائزين».'
          : 'Stored as a flag only — nothing is sent automatically today.'}
      </p>

      {problems.length > 0 && (
        <div className="ga-warn">
          <Icon name="warning" size={15} />
          <span>{problems.join(' ')}</span>
        </div>
      )}

      <div className="ga-actions">
        <button
          type="button" className="ga-btn is-primary"
          disabled={saving || problems.length > 0} onClick={onSave}
        >
          <Icon name="check" size={14} /> {ar ? 'حفظ' : 'Save'}
        </button>
        <button type="button" className="ga-btn" disabled={saving} onClick={onCancel}>
          {ar ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// standings table (live) / frozen winners
// ---------------------------------------------------------------------------
function StandingsTable({ ar, mode, rows, frozen = false }) {
  return (
    <div className="ga-tablewrap">
      <table className="ga-table">
        <thead>
          <tr>
            <th>{ar ? 'المركز' : 'Rank'}</th>
            <th>{ar ? 'اللاعب' : 'Player'}</th>
            <th>{ar ? 'النتيجة المعتمدة' : 'Value'}</th>
            {!frozen && <th>{ar ? 'الدليل' : 'Evidence'}</th>}
            {!frozen && <th>{ar ? 'آخر نشاط' : 'Last seen'}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.deviceId || r.rank}>
              <td className="ga-num">{fmtInt(r.rank)}</td>
              <td>
                <div className="ga-cellname">
                  <strong>{rowName(r, ar)}</strong>
                  <small className="ga-num">{r.phone ? maskPhone(r.phone) : (ar ? 'بلا رقم جوال' : 'no phone')}</small>
                </div>
              </td>
              <td className="ga-num"><strong>{valueLabel(mode, frozen ? r.score : r.value, ar)}</strong></td>
              {!frozen && (
                <td className="ga-evi">
                  <span className="ga-num">{fmtInt(r.plays)} {ar ? 'جولة' : 'plays'}</span>
                  <span className="ga-num">{fmtInt(r.activeDays)} {ar ? 'يوم نشط' : 'active days'}</span>
                  {r.bestGameId ? <span>{gameName(r.bestGameId, ar)}</span> : null}
                  {r.bestAt ? <span className="ga-num">{ar ? 'أفضل جولة' : 'best'}: {dateTime(r.bestAt)}</span> : null}
                  {r.boardBest != null && r.boardBest !== r.bestScore && (
                    <span className="ga-thin">
                      {ar ? 'لوحة الشهر تسجّل' : 'monthly board'} <span className="ga-num">{fmtInt(r.boardBest)}</span>
                    </span>
                  )}
                </td>
              )}
              {!frozen && <td className="ga-num">{dateTime(r.lastAt)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// A tournament with no window has nothing to read, so the empty report is
// marked COVERED — silence is correct there. A thrown read is the opposite:
// covers=false, because zero rows then means "unknown", not "none".
// `cap` is null, not a number: no read was issued here, so quoting a limit
// would be quoting a bound nothing was measured against. The UI only ever
// prints a cap for a read that succeeded AND fell short, which this never is.
const emptyPlaysRead = (ok = true) => ({
  rows: [], scanned: 0, pages: 0, cap: null, capped: false, exhausted: ok, mode: 'none',
  oldestScannedMs: null, newestScannedMs: null, covers: ok, ok,
})

// ---------------------------------------------------------------------------
// one tournament, opened
// ---------------------------------------------------------------------------
function Detail({
  ar, tenantId, t, scores, profiles, canEdit, onBack, onEdit, onChanged,
}) {
  // The READ REPORT from fetchPlays, not a bare array: `read.covers` is the
  // only thing that separates "nobody qualified" from "the capped read never
  // reached this tournament's window".
  const [read, setRead] = useState(null)
  const [err, setErr] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (!tenantId || !t.from || !t.to) { setRead(emptyPlaysRead()); return undefined }
    let alive = true
    setRead(null); setErr(''); setConfirming(false)
    fetchPlays(tenantId, t.from, t.to)
      .then((r) => { if (alive) setRead(r) })
      .catch((e) => { if (alive) { setRead(emptyPlaysRead(false)); setErr(String(e?.message || e)) } })
    return () => { alive = false }
  }, [tenantId, t.id, t.from, t.to])

  const plays = read ? read.rows : null

  // The read report goes in WITH the rows. standings() turns it into `complete`,
  // and finalize() refuses to freeze anything that is not complete — so the gate
  // survives even if this component is not the only caller one day.
  const computed = useMemo(
    () => (plays ? standings({ tournament: t, plays, scores, profiles, read }) : null),
    [plays, read, t, scores, profiles],
  )

  const status = statusOf(t)
  // TWO different facts, never one flag. The report already separates them and
  // the screen must too:
  //   readFailed — the read itself threw; we know NOTHING about this window.
  //   capShort   — the read succeeded but stopped at its cap before covering
  //                the window, so what we have is a floor.
  // Only `capShort` is allowed to speak about a document cap or an oldest-read
  // date: on a failed read there is no cap story and no oldest row, and telling
  // the manager one would be inventing an explanation for an unknown state.
  // NOT `plays.length >= cap`: the window filter runs after the cap, so a
  // tournament older than the cap reaches would zero out the rows AND the
  // warning at once. `covers` is computed before the filter.
  const readFailed = !!read && !read.ok
  const capShort = !!read && read.ok && !read.covers
  // Either cause means an empty table reads "not read", not "nobody entered",
  // and either one blocks announcing.
  const unread = readFailed || capShort
  const oldestRead = read && read.oldestScannedMs ? dayStamp(read.oldestScannedMs) : ''
  // What the standing is allowed to claim about itself. Anything but `true` and
  // the rows on screen are a floor over a partial read: shown, labelled, and NOT
  // announceable.
  const complete = Boolean(computed && computed.complete)

  const doFinalize = async () => {
    if (!computed || !complete || working) return
    setWorking(true)
    try {
      await finalize(tenantId, t, computed)
      setConfirming(false)
      onChanged?.()
    } catch (e) {
      setErr(String(e?.message || e))
    } finally { setWorking(false) }
  }

  const doReopen = async () => {
    if (working) return
    setWorking(true)
    try { await reopen(tenantId, t); onChanged?.() } catch (e) { setErr(String(e?.message || e)) } finally { setWorking(false) }
  }

  return (
    <div className="ga-stack">
      <div className="ga-sheet-head">
        <button type="button" className="ga-back" onClick={onBack}>
          <Icon name="back" size={16} /> <span>{ar ? 'كل البطولات' : 'All tournaments'}</span>
        </button>
        <span className="ga-grow" />
        <span className={`ga-pill is-${status}`}>{STATUS_AR[status]}</span>
        {canEdit && !t.finalizedAt && (
          <button type="button" className="ga-btn" onClick={() => onEdit(t)}>
            <Icon name="edit" size={14} /> {ar ? 'تعديل' : 'Edit'}
          </button>
        )}
      </div>

      <div className="ga-card">
        <div className="ga-sheet-title">
          <span className="ga-ico"><Icon name="award" size={22} /></span>
          <div className="ga-sheet-t">
            <strong>{t.name}</strong>
            <span className="ga-num">{dayStamp(t.from)} — {dayStamp(t.to)}</span>
          </div>
        </div>
        <div className="ga-figs">
          <div className="ga-fig">
            <span className="ga-fig-l">{ar ? 'اللعبة' : 'Game'}</span>
            <strong className="ga-fig-v">{gameName(t.gameId, ar)}</strong>
          </div>
          <div className="ga-fig">
            <span className="ga-fig-l">{ar ? 'الترتيب' : 'Mode'}</span>
            <strong className="ga-fig-v">{modeInfo(t.mode).ar}</strong>
          </div>
          <div className="ga-fig">
            <span className="ga-fig-l">{ar ? 'الجائزة' : 'Prize'}</span>
            <strong className="ga-fig-v">
              {prizeText(t.prize, ar) || <span className="ga-of">{ar ? 'لم تُكتب جائزة' : 'none written'}</span>}
            </strong>
          </div>
        </div>
        <p className="ga-hint">{modeInfo(t.mode).howAr}</p>
      </div>

      {err && (
        <div className="ga-warn">
          <Icon name="warning" size={15} />
          <span>{ar ? 'تعذّرت العملية: ' : 'Failed: '}{err}</span>
        </div>
      )}

      {/* frozen result */}
      {t.finalizedAt ? (
        <div className="ga-card">
          <div className="ga-card-t">
            <Icon name="award" size={15} /> {ar ? 'النتيجة المعلَنة' : 'Announced result'}
            <span className="ga-grow" />
            <span className="ga-of ga-num">{dateTime(t.finalizedAt)}</span>
          </div>
          {t.winners.length ? (
            <>
              <StandingsTable ar={ar} mode={t.mode} rows={t.winners} frozen />
              <p className="ga-hint">
                {ar
                  ? `هذه النتيجة مجمّدة على البطولة ولا تتغيّر بعد اليوم، حتى لو سُجّلت جولات جديدة. أعلى ${fmtInt(MAX_WINNERS)} مراكز تُحفظ.`
                  : 'Frozen — later plays do not change it.'}
              </p>
            </>
          ) : (
            <p className="ga-hint">
              {ar
                ? 'أُغلقت هذه البطولة دون أي فائز، لأن ولا جولة واحدة استوفت شروطها داخل فترتها. لم يُخترع فائز.'
                : 'Closed with no winner: nothing qualified. No winner was invented.'}
            </p>
          )}
          {canEdit && (
            <div className="ga-actions">
              <button type="button" className="ga-btn" disabled={working} onClick={doReopen}>
                <Icon name="undo" size={14} /> {ar ? 'إعادة فتح البطولة' : 'Reopen'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="ga-card">
          <div className="ga-card-t">
            <Icon name="chartBar" size={15} /> {ar ? 'الترتيب المباشر' : 'Live standings'}
          </div>

          {plays === null && <div className="ga-loading"><Spinner /></div>}

          {plays !== null && computed && (
            computed.rows.length ? (
              <>
                <StandingsTable ar={ar} mode={t.mode} rows={computed.rows} />
                <p className="ga-hint ga-num">{computed.noteAr}</p>
                {computed.thin && (
                  <p className="ga-hint">
                    {ar
                      ? `العيّنة صغيرة (أقل من ${fmtInt(computed.minSample)} جولة). الترتيب صحيح لكنه قد ينقلب بجولة واحدة.`
                      : 'Thin sample — the order can flip on a single play.'}
                  </p>
                )}
                {readFailed && (
                  <div className="ga-warn">
                    <Icon name="warning" size={15} />
                    <span>
                      {ar
                        ? 'تعذّرت قراءة سجل الجولات، فلا نعرف كم جولة تخصّ هذه البطولة ولا ماذا ينقص هذا الترتيب. أعد تحميل الصفحة قبل الاعتماد عليه.'
                        : 'The play log could not be read, so we do not know what this ranking is missing. Reload the page before relying on it.'}
                    </span>
                  </div>
                )}
                {capShort && (
                  <div className="ga-warn">
                    <Icon name="warning" size={15} />
                    <span>
                      {ar
                        ? `قُرئت ${fmtInt(read.scanned)} جولة ثم توقف المسح عند سقف الأمان (${fmtInt(read.cap)} جولة) قبل أن يستوفي فترة البطولة${oldestRead ? ` — لم يتجاوز ${oldestRead}` : ''}. هذا الترتيب محسوب على ما قُرئ وحده وقد ينقصه فائز حقيقي. اجعل فترة البطولة أقصر: الفترة الأقصر تحوي جولات أقل فيكتمل مسحها.`
                        : `Read ${read.scanned} plays, then stopped at the safety ceiling (${read.cap}) before finishing the tournament window${oldestRead ? `; it reached back only to ${oldestRead}` : ''}. This ranking covers what was read only. Shorten the window so the scan can finish.`}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* BOTH causes belong in this title: either way the emptiness
                    is unmeasured, so «لا نتائج بعد» would be a claim we cannot
                    back. The sentence underneath is what must differ. */}
                <p className="ga-empty-t">
                  {unread
                    ? (ar ? 'لم تُقرأ جولات هذه الفترة' : 'This period was not read')
                    : (ar ? 'لا نتائج بعد' : 'No results yet')}
                </p>
                <p className="ga-hint">{computed.noteAr}</p>
                <p className="ga-hint">
                  {readFailed
                    ? (ar
                      ? 'تعذّرت قراءة سجل الجولات من قاعدة البيانات، فلم يصلنا شيء عن هذه الفترة. الفراغ هنا يعني «لم يُقرأ»، لا «لم يشارك أحد» — أعد تحميل الصفحة، ولا تُنهِ البطولة الآن.'
                      : 'The play log could not be read at all, so nothing about this window reached us. Empty means "not read", not "nobody entered". Reload before finalizing.')
                    : capShort
                      ? (ar
                        ? `قُرئت ${fmtInt(read.scanned)} جولة ثم توقف المسح عند سقف الأمان (${fmtInt(read.cap)} جولة) قبل أن يستوفي فترة هذه البطولة${oldestRead ? `، وأقدم جولة قرأناها بتاريخ ${oldestRead}` : ''}. الفراغ هنا يعني «لم يُقرأ»، لا «لم يشارك أحد» — اجعل فترة البطولة أقصر ليكتمل المسح، ولا تُنهِها على هذه الشاشة.`
                        : `Read ${read.scanned} plays, then stopped at the safety ceiling (${read.cap}) before finishing this tournament's window${oldestRead ? `; the oldest play read is dated ${oldestRead}` : ''}. Empty means "not read", not "nobody entered". Shorten the window so the scan can finish.`)
                      : (ar
                        ? 'يظهر الترتيب هنا تلقائياً عند أول جولة تستوفي شروط البطولة. لن يُعرض ترتيب مُختلق لملء الفراغ.'
                        : 'The table appears on the first qualifying play. No placeholder ranking is drawn.')}
                </p>
              </>
            )
          )}

          {canEdit && plays !== null && computed && (
            <div className="ga-actions">
              {!complete ? (
                // The action is REMOVED, not merely warned about. A freeze is
                // permanent from the guest's side: the wrong name is announced,
                // the prize is handed over, and the truncation that caused it
                // leaves no trace on the frozen document. A manager may narrow
                // the window and come back; nobody can un-announce a winner.
                // The block is the same either way; the REASON and the way out
                // are not. Telling a manager to narrow the window when the read
                // simply failed is advice that can never clear the block.
                <span className="ga-hint">
                  {readFailed
                    ? (ar
                      ? 'الإعلان موقوف: تعذّرت قراءة سجل الجولات، وتجميد ترتيب لم يُقرأ من بيانات ليس إعلاناً بل خطأ دائم. أعد تحميل الصفحة، فإن تكرّر الخطأ راجع صلاحيات القراءة.'
                      : 'Announcing is blocked: the play log could not be read, and freezing a standing built on no data is a permanent error. Reload the page; if it keeps failing, check read permissions.')
                    : (ar
                      ? 'الإعلان موقوف: جولات هذه الفترة أكثر من سقف المسح الآمن، فالقراءة لم تشملها كاملة، وتجميد ترتيب يعرف النظام أنه قد يكون ناقصاً ليس إعلاناً بل خطأ دائم. عدّل تاريخ البطولة إلى فترة أقصر — الفترة الأقصر تحوي جولات أقل فيكتمل مسحها ويُفتح الإعلان.'
                      : 'Announcing is blocked: this window holds more plays than the safety ceiling scans, so the read did not cover it, and freezing a standing known to be possibly incomplete is a permanent error. Edit the tournament to a shorter window — fewer plays fit in it, the scan completes, and announcing unlocks.')}
                </span>
              ) : !confirming ? (
                <button type="button" className="ga-btn is-primary" disabled={working} onClick={() => setConfirming(true)}>
                  <Icon name="award" size={14} /> {ar ? 'إنهاء وإعلان الفائزين' : 'Finalize & announce'}
                </button>
              ) : (
                <>
                  <span className="ga-hint">
                    {computed.rows.length
                      ? (ar
                        ? `سيُجمَّد أعلى ${fmtInt(Math.min(computed.rows.length, MAX_WINNERS))} مركز كما هو على الشاشة، وتُغلق البطولة.`
                        : 'The visible ranking will be frozen and the tournament closed.')
                      // Only claim "nobody qualified" when the read actually
                      // covered the window; otherwise the honest sentence is
                      // that nothing was read — and WHY differs.
                      : readFailed
                        ? (ar
                          ? 'تعذّرت قراءة سجل الجولات، فلا يمكن القول إن أحداً لم يتأهّل. الإغلاق الآن سيسجّل «بلا فائز» دون أي بيانات.'
                          : 'The play log could not be read, so "nobody qualified" is unknown. Closing now would record no winner on no data at all.')
                        : capShort
                          ? (ar
                            ? 'القراءة لم تغطِّ فترة البطولة، فلا يمكن القول إن أحداً لم يتأهّل. الإغلاق الآن سيسجّل «بلا فائز» على بيانات ناقصة.'
                            : 'The read did not cover the window, so "nobody qualified" is unknown. Closing now would record no winner on incomplete data.')
                          : (ar
                            ? 'لا يوجد أي فائز مؤهّل. الإغلاق سيسجّل «بلا فائز» ولن يخترع أحداً.'
                            : 'Nobody qualified — it will close with no winner.')}
                  </span>
                  <button type="button" className="ga-btn is-primary" disabled={working} onClick={doFinalize}>
                    <Icon name="check" size={14} /> {ar ? 'تأكيد' : 'Confirm'}
                  </button>
                  <button type="button" className="ga-btn" disabled={working} onClick={() => setConfirming(false)}>
                    {ar ? 'تراجع' : 'Cancel'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// panel
// ---------------------------------------------------------------------------
export default function TournamentsPanel({
  ar = true, tenantId, canEdit = false, scores = [], profiles = [],
}) {
  const [list, setList] = useState(null)
  const [listErr, setListErr] = useState('')
  const [draft, setDraft] = useState(null)
  const [openId, setOpenId] = useState('')
  const [saving, setSaving] = useState(false)
  const [opErr, setOpErr] = useState('')

  useEffect(() => {
    if (!tenantId) { setList([]); return undefined }
    setList(null); setListErr('')
    const unsub = watchTournaments(tenantId, ({ rows, error }) => {
      setList(rows)
      setListErr(error || '')
    })
    return () => { try { unsub() } catch (_) { /* already gone */ } }
  }, [tenantId])

  const rows = list || []
  const open = openId ? rows.find((x) => x.id === openId) : null

  const onChanged = useCallback(() => { /* the listener re-emits; nothing to pull */ }, [])

  const save = async () => {
    if (!draft || saving) return
    setSaving(true); setOpErr('')
    try {
      const id = await saveTournament(tenantId, draft)
      setDraft(null)
      setOpenId(id)
    } catch (e) {
      setOpErr(String(e?.message || e))
    } finally { setSaving(false) }
  }

  const remove = async (t) => {
    if (!canEdit) return
    setOpErr('')
    try {
      await deleteTournament(tenantId, t.id)
      if (openId === t.id) setOpenId('')
    } catch (e) { setOpErr(String(e?.message || e)) }
  }

  if (draft) {
    return (
      <div className="ga-stack">
        {opErr && (
          <div className="ga-warn"><Icon name="warning" size={15} /><span>{opErr}</span></div>
        )}
        <Editor
          ar={ar} draft={draft} saving={saving}
          onChange={setDraft} onSave={save} onCancel={() => { setDraft(null); setOpErr('') }}
        />
      </div>
    )
  }

  if (open) {
    return (
      <Detail
        ar={ar} tenantId={tenantId} t={open} scores={scores} profiles={profiles}
        canEdit={canEdit} onBack={() => setOpenId('')} onChanged={onChanged}
        onEdit={(t) => setDraft({ ...normalizeTournament(t), createdAtExisting: true })}
      />
    )
  }

  return (
    <div className="ga-stack">
      <div className="ga-card">
        <div className="ga-card-t">
          <Icon name="award" size={15} /> {ar ? 'بطولات هذا المكان' : 'Tournaments'}
          <span className="ga-grow" />
          {canEdit && (
            <button type="button" className="ga-btn is-primary" onClick={() => setDraft(newTournament())}>
              <Icon name="add" size={14} /> {ar ? 'بطولة جديدة' : 'New'}
            </button>
          )}
        </div>
        <p className="ga-hint">
          {ar
            ? 'البطولة تُرتَّب من جولات اللعب الحقيقية داخل فترتها — لا يُدخل أحد النتائج يدوياً، ولا يظهر فائز لم يلعب.'
            : 'Ranked from real recorded plays inside its own window.'}
        </p>
      </div>

      {opErr && <div className="ga-warn"><Icon name="warning" size={15} /><span>{opErr}</span></div>}

      {list === null && <div className="ga-card"><div className="ga-loading"><Spinner /></div></div>}

      {list !== null && listErr && (
        <div className="ga-warn">
          <Icon name="warning" size={15} />
          <span>
            {listErr === 'permission'
              ? (ar ? 'لا تملك صلاحية قراءة بطولات هذا المكان.' : 'No permission to read tournaments.')
              : listErr === 'unavailable'
                ? (ar ? 'الاتصال بقاعدة البيانات غير مُهيَّأ في هذه البيئة.' : 'Database not configured.')
                : `${ar ? 'تعذّرت قراءة البطولات: ' : 'Could not read tournaments: '}${listErr}`}
          </span>
        </div>
      )}

      {list !== null && !listErr && rows.length === 0 && (
        <div className="ga-card">
          <p className="ga-empty-t">{ar ? 'لا بطولة بعد' : 'No tournaments yet'}</p>
          <p className="ga-hint">
            {ar
              ? 'أنشئ بطولة، حدّد اللعبة والفترة وطريقة الترتيب واكتب الجائزة. من لحظة إنشائها يبدأ النظام بترتيب اللاعبين من جولاتهم الفعلية، ويظهر الترتيب هنا مباشرة.'
              : 'Create one: pick a game, a window, a mode, and write the prize.'}
          </p>
        </div>
      )}

      {rows.map((t) => {
        const st = statusOf(t)
        return (
          <div key={t.id} className="ga-row is-block">
            <button type="button" className="ga-rowmain" onClick={() => setOpenId(t.id)}>
              <span className="ga-rowname">
                {t.name || (ar ? 'بلا اسم' : 'Untitled')}
                <span className={`ga-pill is-${st}`}>{STATUS_AR[st]}</span>
              </span>
              <span className="ga-rowstats ga-num">
                <span>{gameName(t.gameId, ar)}</span>
                <span>{modeInfo(t.mode).ar}</span>
                <span>{dayStamp(t.from)} — {dayStamp(t.to)}</span>
                {t.finalizedAt
                  ? <span>{fmtInt(t.winners.length)} {ar ? 'فائز' : 'winners'}</span>
                  : null}
              </span>
            </button>
            {canEdit && (
              <button
                type="button" className="ga-icobtn" title={ar ? 'حذف' : 'Delete'}
                onClick={() => remove(t)}
              >
                <Icon name="delete" size={15} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
