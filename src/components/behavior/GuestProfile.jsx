import { useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import { Price } from '../Riyal.jsx'
import { fmtNum, normalizePhone } from '../../lib/format.js'
import { customerProfile, dur, clock, dayStamp, dateTime, num, phoneOf, sidOf } from './engine.jsx'

const toMs = (v) => {
  if (!v) return 0
  if (typeof v === 'number') return v
  if (v.toDate) return v.toDate().getTime()
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 0 : d.getTime()
}
const phoneOfDoc = (d) => normalizePhone(d?.customerPhone || d?.phone || d?.id || '')

export default function GuestProfile({
  sessions = [], orders = [], customers = [], reservations = [], tickets = [],
  ar = true, currency = 'SAR', lang = 'ar', showMoney = true,
}) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(null) // { phone } | { deviceId }

  // Candidates come from the sessions themselves plus the customer directory, so
  // an anonymous device that never left a phone number is still findable.
  const candidates = useMemo(() => {
    const map = new Map()
    sessions.forEach((s) => {
      const p = phoneOf(s)
      const key = p ? `p:${p}` : `d:${s.deviceId || sidOf(s)}`
      const cur = map.get(key) || {
        key,
        phone: p ? (s.customerPhone || p) : '',
        deviceId: s.deviceId || '',
        name: s.customerName || '',
        sessions: 0,
        lastAt: 0,
        anonymous: !p,
      }
      cur.sessions += 1
      cur.lastAt = Math.max(cur.lastAt, num(s.lastAt) || num(s.startedAt))
      if (!cur.name && s.customerName) cur.name = s.customerName
      map.set(key, cur)
    })
    customers.forEach((c) => {
      const p = normalizePhone(c.phone || c.id)
      if (!p) return
      const key = `p:${p}`
      const cur = map.get(key) || { key, phone: c.phone || p, deviceId: '', name: c.name || '', sessions: 0, lastAt: toMs(c.lastOrderAt), anonymous: false }
      if (!cur.name && c.name) cur.name = c.name
      map.set(key, cur)
    })
    return [...map.values()].sort((a, b) => b.lastAt - a.lastAt)
  }, [sessions, customers])

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return candidates.slice(0, 30)
    const digits = normalizePhone(term)
    return candidates.filter((c) => (
      (digits && normalizePhone(c.phone).includes(digits))
      || (c.name || '').toLowerCase().includes(term)
      || (c.deviceId || '').toLowerCase().includes(term)
    )).slice(0, 40)
  }, [candidates, q])

  const profile = useMemo(() => (picked ? customerProfile(sessions, picked) : null), [sessions, picked])

  const wanted = picked && picked.phone ? normalizePhone(picked.phone) : ''
  const myOrders = useMemo(
    () => (wanted ? orders.filter((o) => phoneOfDoc(o) === wanted).sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt)) : []),
    [orders, wanted],
  )
  const customer = useMemo(() => (wanted ? customers.find((c) => normalizePhone(c.phone || c.id) === wanted) || null : null), [customers, wanted])
  const myRes = useMemo(() => (wanted ? reservations.filter((r) => phoneOfDoc(r) === wanted) : []), [reservations, wanted])
  const myTickets = useMemo(() => (wanted ? tickets.filter((t) => phoneOfDoc(t) === wanted) : []), [tickets, wanted])

  return (
    <div className="bhv-two bhv-journey">
      <div className="bhv-card">
        <span className="bhv-card-t"><Icon name="customers" size={17} /> {ar ? 'ابحث عن ضيف' : 'Find a guest'}</span>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={ar ? 'رقم الجوال أو الاسم' : 'Phone or name'}
        />
        <p className="bhv-hint">
          {ar
            ? 'الضيوف المسجّلون يُربطون برقم الجوال، والمجهولون بمعرّف الجهاز. الجلسات الأقدم لنفس الجهاز تُضاف تلقائياً وتُعلَّم.'
            : 'Registered guests link by phone, anonymous ones by device id.'}
        </p>
        <div className="bhv-slist bhv-scroll-y">
          {!results.length && <p className="bhv-hint">{ar ? 'لا نتائج.' : 'No matches.'}</p>}
          {results.map((c) => {
            const active = picked && ((c.phone && normalizePhone(c.phone) === wanted) || (!c.phone && picked.deviceId === c.deviceId))
            return (
              <button
                type="button"
                key={c.key}
                className={`bhv-sitem${active ? ' is-active' : ''}`}
                onClick={() => setPicked(c.phone ? { phone: c.phone } : { deviceId: c.deviceId })}
              >
                <span className="bhv-sitem-top">
                  <span className="bhv-sitem-who">{c.name || c.phone || (ar ? 'زائر مجهول' : 'Anonymous')}</span>
                  {c.anonymous && <span className="bhv-mini">{ar ? 'مجهول' : 'anon'}</span>}
                </span>
                <span className="bhv-sitem-meta bhv-num">
                  {c.phone ? c.phone : (c.deviceId || '').slice(0, 12)}
                  {c.sessions ? ` · ${fmtNum(c.sessions)} ${ar ? 'جلسة' : 'sess.'}` : ''}
                  {c.lastAt ? ` · ${dayStamp(c.lastAt)}` : ''}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="bhv-card">
        {!profile ? (
          <>
            <span className="bhv-card-t"><Icon name="user" size={17} /> {ar ? 'ملف الضيف' : 'Guest profile'}</span>
            <p className="bhv-hint">{ar ? 'اختر ضيفاً لعرض قصته الكاملة: كل جلساته، ما شاهده مقابل ما طلبه، بحثه، وطلباته.' : 'Pick a guest.'}</p>
          </>
        ) : (
          <GuestStory
            p={profile} customer={customer} orders={myOrders} reservations={myRes} tickets={myTickets}
            ar={ar} currency={currency} lang={lang} showMoney={showMoney}
          />
        )}
      </div>
    </div>
  )
}

function GuestStory({ p, customer, orders, reservations, tickets, ar, currency, lang, showMoney }) {
  const spent = orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + num(o.total), 0)
  const mem = customer && (customer.membership || null)

  return (
    <>
      <div className="bhv-row-between">
        <span className="bhv-card-t"><Icon name="user" size={17} /> {p.name || p.phone || (ar ? 'زائر مجهول' : 'Anonymous')}</span>
        {p.phone
          ? <span className="bhv-mini bhv-num">{p.phone}</span>
          : <span className="bhv-mini">{ar ? 'بلا رقم — لا يمكن مراسلته' : 'unreachable'}</span>}
      </div>

      <div className="bhv-kpis bhv-kpis-sm">
        <div className="bhv-kpi"><span className="bhv-kpi-l">{ar ? 'الجلسات' : 'Sessions'}</span><strong className="bhv-kpi-v bhv-num">{fmtNum(p.sessionCount)}</strong><span className="bhv-kpi-s">{fmtNum(p.orderedCount)} {ar ? 'انتهت بطلب' : 'ordered'}</span></div>
        <div className="bhv-kpi"><span className="bhv-kpi-l">{ar ? 'إجمالي الوقت النشط' : 'Active time'}</span><strong className="bhv-kpi-v bhv-num">{dur(p.totalActiveMs, ar)}</strong><span className="bhv-kpi-s">{ar ? 'داخل المنيو' : 'in menu'}</span></div>
        <div className="bhv-kpi"><span className="bhv-kpi-l">{ar ? 'أصناف شاهدها' : 'Items viewed'}</span><strong className="bhv-kpi-v bhv-num">{fmtNum(p.itemsViewed.length)}</strong><span className="bhv-kpi-s">{fmtNum(p.itemsOrdered.length)} {ar ? 'طلبها فعلاً' : 'ordered'}</span></div>
        <div className="bhv-kpi"><span className="bhv-kpi-l">{ar ? 'الإنفاق' : 'Spend'}</span><strong className="bhv-kpi-v">{showMoney ? <Price value={spent} currency={currency} lang={lang} /> : <span className="bhv-of">—</span>}</strong><span className="bhv-kpi-s">{fmtNum(orders.length)} {ar ? 'طلباً مسجّلاً' : 'orders'}</span></div>
      </div>

      <div className="bhv-facts">
        <span>{ar ? 'أول ظهور' : 'First seen'} <b className="bhv-num">{p.firstAt ? dateTime(p.firstAt) : '—'}</b></span>
        <span>{ar ? 'آخر ظهور' : 'Last seen'} <b className="bhv-num">{p.lastAt ? dateTime(p.lastAt) : '—'}</b></span>
        <span>{ar ? 'عرض ثلاثي الأبعاد' : 'AR opens'} <b className="bhv-num">{fmtNum(p.arOpens)}</b></span>
        <span>{ar ? 'ألعاب' : 'Games'} <b className="bhv-num">{fmtNum(p.gamePlays)}</b></span>
        <span>{ar ? 'أجهزة' : 'Devices'} <b className="bhv-num">{fmtNum(p.deviceIds.length)}</b></span>
      </div>

      {mem && (
        <div className="bhv-sub-block">
          <strong className="bhv-sub-t"><Icon name="award" size={13} /> {ar ? 'العضوية والولاء' : 'Loyalty'}</strong>
          <div className="bhv-facts">
            {mem.tier && <span>{ar ? 'الفئة' : 'Tier'} <b>{mem.tier}</b></span>}
            {mem.id && <span>{ar ? 'رقم العضوية' : 'Member id'} <b className="bhv-num">{mem.id}</b></span>}
            <span>{ar ? 'النقاط' : 'Points'} <b className="bhv-num">{fmtNum(num(mem.points ?? customer.points))}</b></span>
            <span>{ar ? 'الزيارات' : 'Visits'} <b className="bhv-num">{fmtNum(num(customer.visits ?? customer.ordersCount))}</b></span>
          </div>
        </div>
      )}

      {p.zeroSearches.length > 0 && (
        <div className="bhv-sub-block">
          <strong className="bhv-sub-t"><Icon name="search" size={13} /> {ar ? 'بحث عنه ولم يجده' : 'Searched, not found'}</strong>
          <div className="bhv-qchips">
            {p.zeroSearches.map((s, i) => <span className="bhv-qchip is-zero" key={i}>{s.q}<em>{ar ? 'بلا نتائج' : 'no results'}</em></span>)}
          </div>
        </div>
      )}

      {p.searches.length > p.zeroSearches.length && (
        <div className="bhv-sub-block">
          <strong className="bhv-sub-t"><Icon name="search" size={13} /> {ar ? 'كل عمليات البحث' : 'All searches'}</strong>
          <div className="bhv-qchips">
            {p.searches.filter((s) => num(s.results) > 0).map((s, i) => (
              <span className="bhv-qchip" key={i}>{s.q}<b className="bhv-num">{fmtNum(num(s.results))}</b></span>
            ))}
          </div>
        </div>
      )}

      <div className="bhv-sub-block">
        <strong className="bhv-sub-t"><Icon name="eye" size={13} /> {ar ? 'شاهده مقابل طلبه' : 'Viewed vs ordered'}</strong>
        {!p.itemsViewed.length ? <p className="bhv-hint">{ar ? 'لا مشاهدات أصناف مسجّلة.' : 'No item views.'}</p> : (
          <div className="bhv-dwells">
            {p.itemsViewed.slice(0, 25).map((it) => (
              <div className="bhv-dwell" key={it.itemId}>
                <span className="bhv-dwell-n">{it.name}</span>
                <span className="bhv-bar-track">
                  <span className={`bhv-bar-fill${it.ordered ? ' is-ok' : ''}`} style={{ width: `${Math.min(100, (it.dwellMs / Math.max(1, p.itemsViewed[0].dwellMs)) * 100)}%` }} />
                </span>
                <span className="bhv-dwell-v bhv-num">{dur(it.dwellMs, ar)}</span>
                <span className="bhv-dwell-tag">{it.ordered ? `${ar ? 'طلبه' : 'ordered'} ×${fmtNum(it.ordered)}` : (ar ? 'لم يطلبه' : 'never ordered')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bhv-sub-block">
        <strong className="bhv-sub-t"><Icon name="clock" size={13} /> {ar ? 'جلساته' : 'Sessions'}</strong>
        <div className="bhv-slist bhv-scroll-y bhv-slist-flat">
          {p.sessions.map((s) => (
            <div className="bhv-srow" key={s.sid}>
              <span className="bhv-num">{dayStamp(s.startedAt)} {clock(s.startedAt)}</span>
              <span className="bhv-num">{dur(s.durationMs, ar)}</span>
              <span className="bhv-num">{fmtNum(s.itemsSeen)} {ar ? 'صنفاً' : 'items'}</span>
              <span>{s.table ? `${ar ? 'طاولة' : 'table'} ${s.table}` : (ar ? 'مباشر' : 'direct')}</span>
              <span className={`bhv-ev-out is-${s.ordered ? 'ordered' : 'left'}`}>{s.ordered ? (ar ? 'طلب' : 'ordered') : (ar ? 'بلا طلب' : 'no order')}</span>
              {s.linkedByDevice && <span className="bhv-mini">{ar ? 'جلسة أقدم لنفس الجهاز' : 'same device'}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="bhv-sub-block">
        <strong className="bhv-sub-t"><Icon name="orders" size={13} /> {ar ? 'طلباته' : 'Orders'}</strong>
        {!p.phone ? (
          <p className="bhv-hint">{ar ? 'زائر مجهول بلا رقم — لا يمكن ربطه بطلبات مسجّلة.' : 'Anonymous guest: cannot be linked to orders.'}</p>
        ) : !orders.length ? (
          <p className="bhv-hint">{ar ? 'لا طلبات مسجّلة بهذا الرقم داخل الفترة المحمّلة.' : 'No orders for this phone in the loaded period.'}</p>
        ) : (
          <div className="bhv-slist bhv-scroll-y bhv-slist-flat">
            {orders.slice(0, 25).map((o) => (
              <div className="bhv-srow" key={o.id}>
                <span className="bhv-num">{o.code || o.id.slice(0, 6)}</span>
                <span className="bhv-num">{dateTime(toMs(o.createdAt))}</span>
                <span>{o.status}</span>
                <span>{showMoney ? <Price value={num(o.total)} currency={currency} lang={lang} /> : '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {reservations.length > 0 && (
        <div className="bhv-sub-block">
          <strong className="bhv-sub-t"><Icon name="reservations" size={13} /> {ar ? 'الحجوزات' : 'Reservations'}</strong>
          <div className="bhv-slist bhv-scroll-y bhv-slist-flat">
            {reservations.slice(0, 10).map((r) => (
              <div className="bhv-srow" key={r.id}>
                <span className="bhv-num">{r.date || dayStamp(toMs(r.at || r.createdAt))}</span>
                <span className="bhv-num">{r.time || ''}</span>
                <span>{ar ? 'أشخاص' : 'guests'} <b className="bhv-num">{fmtNum(num(r.guests || r.people))}</b></span>
                <span>{r.status || ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tickets.length > 0 && (
        <div className="bhv-sub-block">
          <strong className="bhv-sub-t"><Icon name="ticket" size={13} /> {ar ? 'التذاكر' : 'Tickets'}</strong>
          <div className="bhv-slist bhv-scroll-y bhv-slist-flat">
            {tickets.slice(0, 10).map((t) => (
              <div className="bhv-srow" key={t.id}>
                <span>{t.eventName || t.eventId || ''}</span>
                <span className="bhv-num">{fmtNum(num(t.qty || 1))}</span>
                <span>{t.status || (t.usedAt ? (ar ? 'مستخدمة' : 'used') : '')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
