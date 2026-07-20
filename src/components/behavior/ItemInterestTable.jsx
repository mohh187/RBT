import { useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import { fmtNum } from '../../lib/format.js'
import { dur, pct, clockSec, dayStamp, num, sidOf } from './engine.jsx'

// Keys are the exact `type` values emitted by src/lib/track.js. An unknown type
// is shown raw — never renamed into something the data does not say.
const EV_AR = {
  view: 'فتح شاشة', tap: 'ضغطة', itemView: 'فتح صنفاً', itemClose: 'أغلق الصنف',
  cartAdd: 'أضاف للسلة', cartRemove: 'حذف من السلة', checkout: 'دخل إتمام الطلب',
  ordered: 'أتمّ الطلب', search: 'بحث', ar: 'فتح العرض ثلاثي الأبعاد',
  game: 'لعب لعبة', identify: 'أدخل بياناته',
}
// abandonedAt arrives as "item:<id>" or "page:<name>" — decode it rather than
// printing a raw key at the manager.
const evLabel = (t) => {
  const raw = String(t || '')
  if (EV_AR[raw]) return EV_AR[raw]
  if (raw.startsWith('item:')) return `صنف: ${raw.slice(5)}`
  if (raw.startsWith('page:')) return `شاشة: ${raw.slice(5)}`
  return raw || '—'
}

// `t` may be an absolute epoch or an offset from the session start.
const evTime = (ev, startedAt) => {
  const t = num(ev && ev.t)
  if (!t) return startedAt
  return t > 1e12 ? t : startedAt + t
}

const TONE_ICON = { bad: 'warning', warn: 'warning', good: 'check', neutral: 'notepad' }

export default function ItemInterestTable({ rows = [], sessions = [], ar = true }) {
  const [openId, setOpenId] = useState('')
  const [sort, setSort] = useState('lost')

  const sorted = useMemo(() => {
    const list = [...rows]
    const by = {
      lost: (a, b) => b.lost - a.lost || b.lostDwellMs - a.lostDwellMs,
      views: (a, b) => b.views - a.views,
      dwell: (a, b) => b.avgDwellMs - a.avgDwellMs,
      order: (a, b) => b.orderRate - a.orderRate,
      add: (a, b) => b.addRate - a.addRate,
    }
    return list.sort(by[sort] || by.lost)
  }, [rows, sort])

  const open = sorted.find((r) => r.itemId === openId) || null
  const evidence = useMemo(() => (open ? buildEvidence(open, sessions) : []), [open, sessions])

  if (!rows.length) {
    return (
      <div className="bhv-card">
        <span className="bhv-card-t"><Icon name="star" size={17} /> {ar ? 'الأصناف والاهتمام' : 'Items & interest'}</span>
        <p className="bhv-hint">
          {ar
            ? 'لم تُسجَّل أي مشاهدة صنف في هذه الفترة. تظهر هنا لكل صنف: عدد المشاهدات، متوسط زمن النظر، نسبة الإضافة للسلة، نسبة الطلب، وعدد من شاهدوه ولم يطلبوه.'
            : 'No item views recorded in this period.'}
        </p>
      </div>
    )
  }

  return (
    <div className="bhv-stack">
      <div className="bhv-card">
        <div className="bhv-row-between">
          <span className="bhv-card-t"><Icon name="star" size={17} /> {ar ? 'الأصناف والاهتمام' : 'Items & interest'}</span>
          <div className="segmented bhv-sortseg">
            <button className={sort === 'lost' ? 'active' : ''} onClick={() => setSort('lost')}>{ar ? 'الأكثر تسرّباً' : 'Most lost'}</button>
            <button className={sort === 'views' ? 'active' : ''} onClick={() => setSort('views')}>{ar ? 'المشاهدات' : 'Views'}</button>
            <button className={sort === 'dwell' ? 'active' : ''} onClick={() => setSort('dwell')}>{ar ? 'زمن النظر' : 'Dwell'}</button>
            <button className={sort === 'order' ? 'active' : ''} onClick={() => setSort('order')}>{ar ? 'نسبة الطلب' : 'Order rate'}</button>
          </div>
        </div>
        <p className="bhv-hint">
          {ar
            ? 'عمود «شاهدوه ولم يطلبوه» يعني بالضبط: فتح الزائر الصنف، وبقي عليه أكثر من أربع ثوانٍ، ولم يضِفه للسلة إطلاقاً — لا يشمل من مرّ عليه سريعاً. اضغط أي صف لترى الجلسات الفعلية وماذا فعل الزائر قبل الصنف وبعده.'
            : 'The "viewed, not ordered" column means: opened the item, stayed past four seconds, never added it to the cart. Tap a row for the real sessions behind the number.'}
        </p>
        <p className="bhv-hint">
          {ar
            ? 'تحذير في القراءة: مدة البقاء تعني أن الصنف كان مفتوحاً على الشاشة فقط. لا تفرّق بين من يقرأ الوصف ومن ترك جواله على الطاولة. اقرأها كسؤال يستحق التحقق، لا كدليل على نية الضيف.'
            : 'Caveat: dwell only means the item was open on screen. Treat it as a question, not proof of intent.'}
        </p>

        <div className="bhv-scroll-x">
          <table className="bhv-table">
            <thead>
              <tr>
                <th>{ar ? 'الصنف' : 'Item'}</th>
                <th>{ar ? 'مشاهدات' : 'Views'}</th>
                <th>{ar ? 'متوسط النظر' : 'Avg dwell'}</th>
                <th>{ar ? 'إضافة للسلة' : 'Add rate'}</th>
                <th>{ar ? 'نسبة الطلب' : 'Order rate'}</th>
                <th>{ar ? 'شاهدوه ولم يطلبوه' : 'Viewed, not ordered'}</th>
                <th>{ar ? 'الحكم' : 'Verdict'}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const active = r.itemId === openId
                return (
                  <tr
                    key={r.itemId}
                    className={`bhv-trow${active ? ' is-open' : ''}`}
                    onClick={() => setOpenId(active ? '' : r.itemId)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(active ? '' : r.itemId) } }}
                  >
                    <td className="bhv-td-name">
                      <Icon name={active ? 'arrowUpDown' : 'next'} size={12} />
                      <span>{r.name}</span>
                    </td>
                    <td className="bhv-num">{fmtNum(r.views)}<em className="bhv-sub">{fmtNum(r.sessions)} {ar ? 'جلسة' : 'sess.'}</em></td>
                    <td className="bhv-num">{dur(r.avgDwellMs, ar)}</td>
                    <td className="bhv-num">{fmtNum(pct(r.addRate))}%<em className="bhv-sub">{fmtNum(r.added)}</em></td>
                    <td className="bhv-num">{fmtNum(pct(r.orderRate))}%<em className="bhv-sub">{fmtNum(r.ordered)}</em></td>
                    <td className="bhv-num bhv-td-lost">
                      <strong>{fmtNum(r.lost)}</strong>
                      <em className="bhv-sub">{ar ? 'بمتوسط' : 'avg'} {dur(r.lostAvgDwellMs, ar)}</em>
                    </td>
                    <td>
                      <span className={`bhv-verdict is-${r.verdict ? r.verdict.tone : 'neutral'}`}>
                        <Icon name={TONE_ICON[r.verdict ? r.verdict.tone : 'neutral']} size={12} />
                        {r.verdict ? r.verdict.ar : '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <div className="bhv-card bhv-evidence">
          <div className="bhv-row-between">
            <span className="bhv-card-t"><Icon name="eye" size={17} /> {ar ? 'الدليل' : 'Evidence'} — {open.name}</span>
            <button className="btn btn-sm btn-outline" onClick={() => setOpenId('')}><Icon name="close" size={14} /> {ar ? 'إغلاق' : 'Close'}</button>
          </div>
          <p className="bhv-hint">
            {ar
              ? `جلسات حقيقية فتح فيها الزائر هذا الصنف وبقي عليه ثم لم يضِفه للسلة (معروض ${fmtNum(evidence.length)} من ${fmtNum(open.lost)}). لكل جلسة: ما فعله قبل الصنف مباشرة وبعده، كما هو مسجّل.`
              : `Real sessions where this item was opened, lingered on, and never added to the cart.`}
          </p>
          {!evidence.length ? (
            <p className="bhv-hint">{ar ? 'لا توجد أحداث مسجّلة لهذه الجلسات — العدّاد موجود لكن سجل الأحداث فارغ، فلا يمكن إثبات التسلسل.' : 'No event trail recorded for these sessions.'}</p>
          ) : (
            <div className="bhv-ev-list bhv-scroll-y">
              {evidence.map((ev) => (
                <div className="bhv-ev" key={ev.sid}>
                  <div className="bhv-ev-head">
                    <span className="bhv-ev-who">
                      <Icon name="user" size={12} />
                      {ev.name || ev.phone || (ar ? 'زائر مجهول' : 'Anonymous')}
                    </span>
                    <span className="bhv-ev-when bhv-num">{dayStamp(ev.startedAt)} {clockSec(ev.startedAt)}</span>
                    <span className={`bhv-ev-out is-${ev.ordered ? 'ordered' : 'left'}`}>
                      {ev.ordered ? (ar ? 'أتم طلباً (بدون هذا الصنف)' : 'Ordered without it') : (ar ? 'خرج بلا طلب' : 'Left without ordering')}
                    </span>
                  </div>
                  <div className="bhv-ev-facts">
                    <span>{ar ? 'بقي عليه' : 'dwell'} <b className="bhv-num">{dur(ev.dwellMs, ar)}</b></span>
                    <span>{ar ? 'أصناف أخرى في الجلسة' : 'other items'} <b className="bhv-num">{fmtNum(ev.otherItems)}</b></span>
                    {ev.removed > 0 && <span className="bhv-ev-warn">{ar ? 'حذفه من السلة' : 'removed from cart'}</span>}
                    {ev.abandonedAt && <span className="bhv-ev-warn">{ar ? 'توقّف عند' : 'stopped at'} {evLabel(ev.abandonedAt)}</span>}
                  </div>
                  {ev.trail.length > 0 ? (
                    <ol className="bhv-trail">
                      {ev.trail.map((e, i) => (
                        <li key={i} className={`bhv-trail-i${e.focus ? ' is-focus' : ''}`}>
                          <span className="bhv-trail-t bhv-num">{clockSec(e.at)}</span>
                          <span className="bhv-trail-x">{evLabel(e.type)}{e.target ? ` — ${e.targetName || e.target}` : ''}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="bhv-hint">{ar ? 'لا سجل أحداث لهذه الجلسة.' : 'No event trail.'}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Builds the "what happened around this item" trail: the item event itself plus
// the three events before and after it, straight from the session document.
// Nothing is inferred — if the session has no events array, the trail is empty
// and the UI says so.
const AROUND = 3
const MAX_EVIDENCE = 40

function buildEvidence(row, sessions) {
  const wanted = new Set(row.lostSids || [])
  const out = []
  sessions.forEach((s) => {
    const sid = sidOf(s)
    if (!wanted.has(sid)) return
    const v = (s.items || {})[row.itemId] || {}
    const events = Array.isArray(s.events) ? s.events : []
    const startedAt = num(s.startedAt)
    const idx = events.findIndex((e) => {
      const tgt = e && (e.target || (e.meta && (e.meta.itemId || e.meta.id)))
      return String(tgt || '') === String(row.itemId)
    })
    // Resolve item ids in the trail to names from the session's own records.
    const names = {}
    Object.entries(s.items || {}).forEach(([id, rec]) => { if (rec && rec.name) names[id] = rec.name })
    let trail = []
    if (events.length) {
      const from = idx >= 0 ? Math.max(0, idx - AROUND) : 0
      const to = idx >= 0 ? Math.min(events.length, idx + AROUND + 1) : Math.min(events.length, AROUND * 2 + 1)
      trail = events.slice(from, to).map((e, i) => ({
        type: e && e.type,
        target: e && e.target,
        targetName: (e && e.meta && (e.meta.name || e.meta.nameAr)) || names[e && e.target] || '',
        at: evTime(e, startedAt),
        focus: idx >= 0 && from + i === idx,
      }))
    }
    out.push({
      sid,
      name: s.customerName || '',
      phone: s.customerPhone || '',
      startedAt,
      ordered: Boolean((s.outcome || {}).ordered),
      abandonedAt: (s.outcome || {}).abandonedAt || '',
      dwellMs: num(v.dwellMs),
      added: num(v.added),
      removed: num(v.removed),
      otherItems: Math.max(0, Object.keys(s.items || {}).length - 1),
      trail,
    })
  })
  return out.sort((a, b) => b.dwellMs - a.dwellMs).slice(0, MAX_EVIDENCE)
}
