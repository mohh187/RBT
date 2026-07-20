// «سجل الإعلانات» — who actually saw each ad, who clicked, and who they were.
//
// Two sources, deliberately kept apart so nothing is ever conflated:
//   • the ad's own counters (stats.*) — every device, including guests who
//     never registered. This is the true reach.
//   • the behaviour sessions — the SAME 'ad' events, but carrying identity when
//     the guest registered. This is who, and what they did afterwards.
// A session-derived number is therefore always <= the counter, and the UI says
// so rather than letting an owner read the smaller number as the whole truth.
import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { db } from '../../lib/firebase.js'
import Icon from '../Icon.jsx'
import { Spinner } from '../ui.jsx'

const DAYS = [7, 30, 90]
const fmt = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')
const pct = (n, of) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '—')

function whenText(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('ar-SA-u-nu-latn', { dateStyle: 'short', timeStyle: 'short' })
}

export default function AdReport({ tenantId, ads = [], lang = 'ar', onOpenAd }) {
  const ar = lang !== 'en'
  const [days, setDays] = useState(30)
  const [sessions, setSessions] = useState(null)
  const [err, setErr] = useState('')
  const [openAd, setOpenAd] = useState('')

  useEffect(() => {
    if (!tenantId) return undefined
    let alive = true
    setSessions(null)
    setErr('')
    ;(async () => {
      const from = Date.now() - days * 86400000
      try {
        const snap = await getDocs(query(
          collection(db, 'tenants', tenantId, 'sessions'),
          where('startedAt', '>=', from),
          orderBy('startedAt', 'desc'),
          limit(500),
        ))
        if (alive) setSessions(snap.docs.map((d) => d.data()))
      } catch (_) {
        // A missing index or a rules gap must not blank the page — the counter
        // view below still works without any session data.
        if (alive) { setSessions([]); setErr(ar ? 'تعذّر تحميل الجلسات — الأرقام الإجمالية أدناه صحيحة، لكن تفاصيل «من شاهد» غير متاحة الآن.' : 'Sessions unavailable; totals below are still correct.') }
      }
    })()
    return () => { alive = false }
  }, [tenantId, days, ar])

  // One pass over the sessions, grouping the 'ad' events by ad id.
  const byAd = useMemo(() => {
    const map = {}
    for (const s of sessions || []) {
      const events = Array.isArray(s.events) ? s.events : []
      const seenHere = {}
      for (const e of events) {
        if (e?.type !== 'ad' || !e.target) continue
        const id = String(e.target)
        const rec = map[id] || (map[id] = { impressions: 0, clicks: 0, dismissals: 0, converts: 0, people: [] })
        const act = e.meta?.action || 'impression'
        if (act === 'impression') rec.impressions++
        else if (act === 'click') rec.clicks++
        else if (act === 'dismiss') rec.dismissals++
        else if (act === 'convert') rec.converts++
        const key = s.customerPhone || s.deviceId || 'x'
        if (!seenHere[id]) seenHere[id] = {}
        if (!seenHere[id][key]) {
          seenHere[id][key] = true
          rec.people.push({
            name: s.customerName || '',
            phone: s.customerPhone || '',
            deviceId: s.deviceId || '',
            at: Number(s.startedAt) || 0,
            clicked: act === 'click' || act === 'convert',
            ordered: !!s.outcome?.ordered,
            total: Number(s.outcome?.total) || 0,
          })
        } else if (act === 'click' || act === 'convert') {
          const p = rec.people.find((x) => (x.phone || x.deviceId) === key)
          if (p) p.clicked = true
        }
      }
    }
    return map
  }, [sessions])

  const rows = useMemo(() => (ads || []).map((ad) => {
    const st = ad.stats || {}
    const s = byAd[ad.id] || { impressions: 0, clicks: 0, dismissals: 0, converts: 0, people: [] }
    const imp = Number(st.impressions) || 0
    return {
      ad,
      imp,
      clicks: Number(st.clicks) || 0,
      dismissals: Number(st.dismissals) || 0,
      converted: Number(st.converted) || 0,
      s,
      known: s.people.filter((p) => p.phone).length,
      orderedAfter: s.people.filter((p) => p.ordered).length,
    }
  }).sort((a, b) => b.imp - a.imp), [ads, byAd])

  const totals = rows.reduce((t, r) => ({
    imp: t.imp + r.imp, clicks: t.clicks + r.clicks, converted: t.converted + r.converted,
  }), { imp: 0, clicks: 0, converted: 0 })

  return (
    <div className="ads-report">
      <div className="ads-rep-head">
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <Icon name="chartBar" size={17} />
          <strong>{ar ? 'سجل الإعلانات ونتائجها' : 'Ad results'}</strong>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {DAYS.map((d) => (
            <button key={d} type="button" className={`chip ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>
              {ar ? `${fmt(d)} يوم` : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      <p className="ads-rep-note">
        {ar
          ? 'الأرقام الإجمالية من عدّادات الإعلان نفسه وتشمل كل جهاز. «من شاهد» يأتي من جلسات التصفح، فيظهر فيه المسجّلون بأسمائهم والبقية كأجهزة — لذلك عدده أقل دائماً، وهذا طبيعي لا نقص.'
          : 'Totals come from the ad counters (every device). The people list comes from browsing sessions, so it is always a subset.'}
      </p>

      {err ? <p className="ads-rep-err">{err}</p> : null}

      <div className="ads-rep-kpis">
        <div><span>{ar ? 'ظهور' : 'Impressions'}</span><b>{fmt(totals.imp)}</b></div>
        <div><span>{ar ? 'ضغطات' : 'Clicks'}</span><b>{fmt(totals.clicks)}</b></div>
        <div><span>{ar ? 'نسبة الضغط' : 'CTR'}</span><b>{pct(totals.clicks, totals.imp)}</b></div>
        <div><span>{ar ? 'استلموا مكافأة' : 'Rewards'}</span><b>{fmt(totals.converted)}</b></div>
      </div>

      {sessions === null ? <div className="center" style={{ padding: 24 }}><Spinner /></div> : null}

      {rows.map((r) => (
        <div key={r.ad.id} className="card ads-rep-row">
          <div className="ads-rep-row-top">
            <button type="button" className="ads-rep-name" onClick={() => onOpenAd?.(r.ad)}>
              {r.ad.name || (ar ? 'إعلان' : 'Ad')}
            </button>
            <span className={`badge ${r.ad.active ? 'badge-success' : ''}`}>
              {r.ad.active ? (ar ? 'نشط' : 'Live') : (ar ? 'متوقف' : 'Paused')}
            </span>
          </div>
          <div className="ads-rep-nums">
            <span>{ar ? 'ظهور' : 'Views'} <b>{fmt(r.imp)}</b></span>
            <span>{ar ? 'ضغط' : 'Clicks'} <b>{fmt(r.clicks)}</b></span>
            <span>{ar ? 'نسبة' : 'CTR'} <b>{pct(r.clicks, r.imp)}</b></span>
            <span>{ar ? 'إغلاق' : 'Dismissed'} <b>{fmt(r.dismissals)}</b></span>
            {r.converted ? <span>{ar ? 'مكافآت' : 'Rewards'} <b>{fmt(r.converted)}</b></span> : null}
          </div>

          {r.s.people.length ? (
            <>
              <button type="button" className="ads-rep-toggle" onClick={() => setOpenAd(openAd === r.ad.id ? '' : r.ad.id)}>
                <Icon name={openAd === r.ad.id ? 'arrowUp' : 'arrowUpDown'} size={13} />
                {ar
                  ? `من شاهده: ${fmt(r.s.people.length)} زائر (${fmt(r.known)} معروفون بالاسم، ${fmt(r.orderedAfter)} طلبوا بعده)`
                  : `${r.s.people.length} viewers`}
              </button>
              {openAd === r.ad.id ? (
                <div className="ads-rep-people">
                  {r.s.people.slice(0, 60).map((p, i) => (
                    <div key={`${p.phone || p.deviceId}-${i}`} className="ads-rep-person">
                      <span className="ads-rep-who">
                        {p.name || (p.phone ? p.phone : (ar ? 'زائر غير مسجّل' : 'Anonymous'))}
                      </span>
                      {p.phone ? <span className="num ads-rep-phone" dir="ltr">{p.phone}</span> : null}
                      <span className="ads-rep-flags">
                        {p.clicked ? <b className="ok">{ar ? 'ضغط' : 'clicked'}</b> : <span>{ar ? 'شاهد فقط' : 'viewed'}</span>}
                        {p.ordered ? <b className="ok">{ar ? `طلب ${fmt(p.total)}` : `ordered ${p.total}`}</b> : null}
                      </span>
                      <span className="ads-rep-when">{whenText(p.at)}</span>
                    </div>
                  ))}
                  {r.s.people.length > 60 ? (
                    <p className="ads-rep-more">{ar ? `و${fmt(r.s.people.length - 60)} غيرهم` : `and ${r.s.people.length - 60} more`}</p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <p className="ads-rep-none">
              {ar ? 'لا توجد مشاهدات مسجّلة في الجلسات لهذه الفترة.' : 'No session-recorded views in this period.'}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
