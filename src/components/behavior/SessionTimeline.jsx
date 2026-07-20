import { useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import { fmtNum, normalizePhone } from '../../lib/format.js'
import { sessionSummary, dur, clock, clockSec, dayStamp, num, sidOf } from './engine.jsx'

// Keys are the exact `type` values emitted by src/lib/track.js. An unknown type
// is rendered raw rather than renamed into something the data does not say.
const EV_AR = {
  view: 'فتح شاشة', tap: 'ضغطة', itemView: 'فتح صنفاً', itemClose: 'أغلق الصنف',
  cartAdd: 'أضاف للسلة', cartRemove: 'حذف من السلة', checkout: 'دخل إتمام الطلب',
  ordered: 'أتمّ الطلب', search: 'بحث', ar: 'فتح العرض ثلاثي الأبعاد',
  game: 'لعب لعبة', identify: 'أدخل بياناته',
}
const EV_ICON = {
  view: 'eye', tap: 'drag', itemView: 'eye', itemClose: 'close', cartAdd: 'cart', cartRemove: 'minus',
  checkout: 'wallet', ordered: 'check', search: 'search', ar: 'layers', game: 'play', identify: 'user',
}
// abandonedAt arrives as "item:<id>" or "page:<name>" — decode it rather than
// printing a raw key at the manager.
const evLabel = (t, ar, names = {}) => {
  const raw = String(t || '')
  if (!ar) return raw || '—'
  if (EV_AR[raw]) return EV_AR[raw]
  if (raw.startsWith('item:')) { const id = raw.slice(5); return `صنف: ${names[id] || id}` }
  if (raw.startsWith('page:')) return `شاشة: ${raw.slice(5)}`
  return raw || '—'
}
const evTime = (ev, startedAt) => {
  const t = num(ev && ev.t)
  if (!t) return startedAt
  return t > 1e12 ? t : startedAt + t
}

export default function SessionTimeline({ sessions = [], ar = true }) {
  const [q, setQ] = useState('')
  const [sid, setSid] = useState('')

  const list = useMemo(() => {
    const term = q.trim().toLowerCase()
    const digits = normalizePhone(term)
    const all = sessions.map(sessionSummary).sort((a, b) => b.startedAt - a.startedAt)
    if (!term) return all.slice(0, 120)
    return all.filter((s) => {
      const p = normalizePhone(s.phone)
      return (
        (digits && p && p.includes(digits))
        || (s.name || '').toLowerCase().includes(term)
        || (s.sid || '').toLowerCase().includes(term)
        || String(s.table || '').toLowerCase().includes(term)
      )
    }).slice(0, 120)
  }, [sessions, q])

  const picked = useMemo(() => {
    if (!sid) return null
    const raw = sessions.find((s) => sidOf(s) === sid)
    return raw ? sessionSummary(raw) : null
  }, [sessions, sid])

  if (!sessions.length) {
    return (
      <div className="bhv-card">
        <span className="bhv-card-t"><Icon name="clock" size={17} /> {ar ? 'رحلة الجلسة' : 'Session journey'}</span>
        <p className="bhv-hint">
          {ar
            ? 'لا جلسات في هذه الفترة. عندما يتصفّح الضيوف المنيو ستظهر هنا كل جلسة بترتيبها الزمني: ماذا فتح، كم نظر لكل صنف، وأين توقّف.'
            : 'No sessions in this period.'}
        </p>
      </div>
    )
  }

  return (
    <div className="bhv-two bhv-journey">
      <div className="bhv-card">
        <span className="bhv-card-t"><Icon name="list" size={17} /> {ar ? 'الجلسات' : 'Sessions'}</span>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={ar ? 'ابحث برقم الجوال أو الاسم أو الطاولة' : 'Search by phone, name or table'}
        />
        <p className="bhv-hint">{ar ? `معروض ${fmtNum(list.length)} جلسة` : `${fmtNum(list.length)} sessions`}</p>
        <div className="bhv-slist bhv-scroll-y">
          {!list.length && <p className="bhv-hint">{ar ? 'لا نتائج مطابقة.' : 'No matches.'}</p>}
          {list.map((s) => (
            <button
              type="button"
              key={s.sid}
              className={`bhv-sitem${s.sid === sid ? ' is-active' : ''}`}
              onClick={() => setSid(s.sid === sid ? '' : s.sid)}
            >
              <span className="bhv-sitem-top">
                <span className="bhv-sitem-who">{s.name || s.phone || (ar ? 'زائر مجهول' : 'Anonymous')}</span>
                <span className={`bhv-dot is-${s.ordered ? 'ok' : 'no'}`} />
              </span>
              <span className="bhv-sitem-meta bhv-num">
                {dayStamp(s.startedAt)} {clock(s.startedAt)} · {dur(s.durationMs, ar)}
                {s.table ? ` · ${s.table}` : ''}
              </span>
              <span className="bhv-sitem-meta">
                {ar ? 'أصناف' : 'items'} <b className="bhv-num">{fmtNum(s.itemsSeen)}</b>
                {' · '}{ar ? 'سلة' : 'cart'} <b className="bhv-num">{fmtNum(s.cartAdds)}</b>
                {s.ordered ? ` · ${ar ? 'طلب' : 'ordered'}` : ` · ${ar ? 'بلا طلب' : 'no order'}`}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="bhv-card">
        {!picked ? (
          <>
            <span className="bhv-card-t"><Icon name="clock" size={17} /> {ar ? 'رحلة الجلسة' : 'Session journey'}</span>
            <p className="bhv-hint">{ar ? 'اختر جلسة من القائمة لعرض تسلسلها الزمني الكامل.' : 'Pick a session to see its timeline.'}</p>
          </>
        ) : (
          <SessionDetail s={picked} ar={ar} />
        )}
      </div>
    </div>
  )
}

function SessionDetail({ s, ar }) {
  const maxDwell = Math.max(1, ...s.itemList.map((i) => i.dwellMs))
  // Item ids in the event stream are meaningless to a manager; resolve them from
  // the session's own item records.
  const names = {}
  s.itemList.forEach((it) => { if (it.name) names[it.itemId] = it.name })
  const events = s.events.map((e) => ({
    type: e && e.type,
    target: e && e.target,
    name: (e && e.meta && (e.meta.name || e.meta.nameAr || e.meta.q)) || names[e && e.target] || '',
    at: evTime(e, s.startedAt),
  }))

  return (
    <>
      <div className="bhv-row-between">
        <span className="bhv-card-t"><Icon name="clock" size={17} /> {s.name || s.phone || (ar ? 'زائر مجهول' : 'Anonymous')}</span>
        <span className={`bhv-ev-out is-${s.ordered ? 'ordered' : 'left'}`}>
          {s.ordered
            ? `${ar ? 'أتم الطلب' : 'Ordered'}${s.total ? ` · ${fmtNum(s.total)}` : ''}`
            : `${ar ? 'غادر بلا طلب' : 'Left without order'}${s.abandonedAt ? ` · ${ar ? 'توقّف عند' : 'at'} ${evLabel(s.abandonedAt, ar, names)}` : ''}`}
        </span>
      </div>

      <div className="bhv-facts">
        <span>{ar ? 'البدء' : 'Start'} <b className="bhv-num">{dayStamp(s.startedAt)} {clockSec(s.startedAt)}</b></span>
        <span>{ar ? 'المدة' : 'Duration'} <b className="bhv-num">{dur(s.durationMs, ar)}</b></span>
        <span>{ar ? 'المصدر' : 'Entry'} <b>{s.table ? `${ar ? 'طاولة' : 'table'} ${s.table}` : (ar ? 'مباشر' : 'direct')}</b></span>
        {s.platform && <span>{ar ? 'الجهاز' : 'Device'} <b>{s.platform}{s.screen ? ` · ${s.screen}` : ''}</b></span>}
        {s.standalone && <span className="bhv-ev-warn">{ar ? 'مثبّت كتطبيق' : 'installed app'}</span>}
        <span>{ar ? 'ضغطات' : 'Taps'} <b className="bhv-num">{fmtNum(s.taps)}</b></span>
        {s.arOpens > 0 && <span>{ar ? 'عرض ثلاثي الأبعاد' : 'AR'} <b className="bhv-num">{fmtNum(s.arOpens)}</b></span>}
        {s.gamePlays > 0 && <span>{ar ? 'ألعاب' : 'Games'} <b className="bhv-num">{fmtNum(s.gamePlays)}</b></span>}
      </div>

      {s.itemList.length > 0 && (
        <div className="bhv-sub-block">
          <strong className="bhv-sub-t">{ar ? 'الأصناف التي نظر إليها' : 'Items viewed'}</strong>
          <div className="bhv-dwells">
            {s.itemList.map((it) => (
              <div className="bhv-dwell" key={it.itemId}>
                <span className="bhv-dwell-n">{it.name}</span>
                <span className="bhv-bar-track"><span className={`bhv-bar-fill${it.ordered ? ' is-ok' : ''}`} style={{ width: `${(it.dwellMs / maxDwell) * 100}%` }} /></span>
                <span className="bhv-dwell-v bhv-num">{dur(it.dwellMs, ar)}</span>
                <span className="bhv-dwell-tag">
                  {it.ordered ? (ar ? 'طلبه' : 'ordered') : it.added ? (ar ? 'أضافه ثم تركه' : 'added, left') : (ar ? 'نظر فقط' : 'looked only')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {s.search.length > 0 && (
        <div className="bhv-sub-block">
          <strong className="bhv-sub-t">{ar ? 'ما بحث عنه' : 'Searches'}</strong>
          <div className="bhv-qchips">
            {s.search.map((q, i) => (
              <span key={i} className={`bhv-qchip${num(q.results) === 0 ? ' is-zero' : ''}`}>
                {q.q}
                <b className="bhv-num">{fmtNum(num(q.results))}</b>
                {num(q.results) === 0 && <em>{ar ? 'بلا نتائج' : 'no results'}</em>}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bhv-sub-block">
        <strong className="bhv-sub-t">{ar ? 'التسلسل الزمني' : 'Timeline'}</strong>
        {s.eventsTruncated && (
          <p className="bhv-hint">
            <Icon name="warning" size={12} />{' '}
            {ar
              ? 'بلغت هذه الجلسة الحد الأقصى للأحداث المحفوظة، فحُذفت أقدمها. ما تراه هنا هو نهاية الرحلة لا بدايتها.'
              : 'This session hit the event cap; the earliest steps were dropped.'}
          </p>
        )}
        {!events.length ? (
          <p className="bhv-hint">{ar ? 'لم تُسجَّل أحداث مفصّلة لهذه الجلسة — العدّادات فقط متاحة.' : 'No detailed events for this session.'}</p>
        ) : (
          <ol className="bhv-tl bhv-scroll-y">
            {events.map((e, i) => (
              <li className="bhv-tl-i" key={i}>
                <span className="bhv-tl-time bhv-num">{clockSec(e.at)}</span>
                <span className="bhv-tl-dot"><Icon name={EV_ICON[e.type] || 'notepad'} size={11} /></span>
                <span className="bhv-tl-x">
                  <b>{evLabel(e.type, ar)}</b>
                  {(e.name || e.target) && <em>{e.name || e.target}</em>}
                </span>
              </li>
            ))}
            <li className="bhv-tl-i is-end">
              <span className="bhv-tl-time bhv-num">{clockSec(s.lastAt || s.startedAt)}</span>
              <span className="bhv-tl-dot"><Icon name={s.ordered ? 'check' : 'close'} size={11} /></span>
              <span className="bhv-tl-x"><b>{s.ordered ? (ar ? 'أتم الطلب' : 'Completed order') : (ar ? 'انتهت الجلسة بلا طلب' : 'Session ended without order')}</b></span>
            </li>
          </ol>
        )}
      </div>
    </>
  )
}
