import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore'
import { db } from '../../lib/firebase.js'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { Spinner } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { CAP } from '../../lib/permissions.js'
import { listOrdersSince, listItems, listCustomers, listReservations } from '../../lib/db.js'
import { fmtNum } from '../../lib/format.js'

import FunnelView from '../../components/behavior/FunnelView.jsx'
import ItemInterestTable from '../../components/behavior/ItemInterestTable.jsx'
import SessionTimeline from '../../components/behavior/SessionTimeline.jsx'
import GuestProfile from '../../components/behavior/GuestProfile.jsx'
import CohortView from '../../components/behavior/CohortView.jsx'
import AiPlanner from '../../components/behavior/AiPlanner.jsx'
import {
  funnel, dropOffPoints, itemInterest, cohorts, aiSnapshot, AI_PLANNER_GUARD_AR,
  overview, searchStats, buildSegments, ruleFindings, dayStamp, engineSources,
} from '../../components/behavior/engine.jsx'

const TABS = [
  { key: 'overview', icon: 'chartBar', ar: 'النظرة العامة', en: 'Overview' },
  { key: 'items', icon: 'star', ar: 'الأصناف والاهتمام', en: 'Items & interest' },
  { key: 'journey', icon: 'clock', ar: 'رحلة الجلسة', en: 'Session journey' },
  { key: 'guest', icon: 'user', ar: 'ملف الضيف', en: 'Guest profile' },
  { key: 'cohorts', icon: 'layers', ar: 'الشرائح', en: 'Cohorts' },
  { key: 'ai', icon: 'sparkles', ar: 'المخطِّط الذكي', en: 'AI planner' },
]

const PERIODS = [
  { key: 'today', ar: 'اليوم', en: 'Today' },
  { key: 'd7', ar: '7 أيام', en: '7 days' },
  { key: 'd30', ar: '30 يوماً', en: '30 days' },
  { key: 'custom', ar: 'مخصص', en: 'Custom' },
]

// Hard ceiling: this page NEVER reads the whole sessions collection. A venue can
// accumulate tens of thousands of session docs; anything unbounded here would be
// a runaway read bill and a frozen browser.
const MAX_SESSIONS = 500

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }

function periodRange(key, custom = {}) {
  const now = new Date()
  let from = startOfDay(now)
  let to = endOfDay(now)
  if (key === 'd7') { from = startOfDay(now); from.setDate(from.getDate() - 6) }
  else if (key === 'd30') { from = startOfDay(now); from.setDate(from.getDate() - 29) }
  else if (key === 'custom') {
    from = custom.from ? startOfDay(new Date(custom.from)) : startOfDay(new Date(now.getFullYear(), now.getMonth(), 1))
    to = custom.to ? endOfDay(new Date(custom.to)) : endOfDay(now)
  }
  if (Number.isNaN(from.getTime())) from = startOfDay(now)
  if (Number.isNaN(to.getTime())) to = endOfDay(now)
  return { from, to }
}

const rowsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))

// Bounded, newest-first. Falls back progressively so a missing index or a strict
// rule degrades to "fewer sessions" instead of a blank page.
async function fetchSessions(tid, fromMs, toMs) {
  const inWindow = (s) => {
    const t = Number(s.startedAt) || 0
    return t >= fromMs && t <= toMs
  }
  const ref = collection(db, 'tenants', tid, 'sessions')
  try {
    return rowsOf(await getDocs(query(ref, where('startedAt', '>=', fromMs), orderBy('startedAt', 'desc'), limit(MAX_SESSIONS)))).filter(inWindow)
  } catch (_) { /* index or rule issue — try the simpler shapes below */ }
  try {
    return rowsOf(await getDocs(query(ref, orderBy('startedAt', 'desc'), limit(MAX_SESSIONS)))).filter(inWindow)
  } catch (_) { /* fall through */ }
  try {
    return rowsOf(await getDocs(query(ref, limit(MAX_SESSIONS)))).filter(inWindow)
  } catch (_) { return [] }
}

// Optional collections: a venue may not use events at all, and the rules may not
// grant this role access. Never let either blank the page.
async function fetchTickets(tid) {
  try {
    return rowsOf(await getDocs(query(collection(db, 'tenants', tid, 'tickets'), limit(200))))
  } catch (_) { return [] }
}

export default function Behavior({ onCreateCampaign, onCreateContent }) {
  const { lang } = useI18n()
  const ar = lang !== 'en'
  const { tenantId, tenant, isManager, can } = useAuth()
  const currency = tenant?.currency || 'SAR'
  const showMoney = can(CAP.VIEW_REVENUE)
  const aiAllowed = can(CAP.USE_ASSISTANT)
  const allowed = isManager || can(CAP.VIEW_REPORTS)

  const [tab, setTab] = useState('overview')
  const [periodKey, setPeriodKey] = useState('d7')
  const [custom, setCustom] = useState(() => {
    const r = periodRange('d7')
    return { from: r.from.toISOString().slice(0, 10), to: r.to.toISOString().slice(0, 10) }
  })
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  const { from, to } = useMemo(() => periodRange(periodKey, custom), [periodKey, custom])
  const fromMs = from.getTime()
  const toMs = to.getTime()

  useEffect(() => {
    if (!tenantId || !allowed) return
    let alive = true
    setData(null); setErr('')
    ;(async () => {
      try {
        const [sessions, orders, items, customers, reservations, tickets] = await Promise.all([
          fetchSessions(tenantId, fromMs, toMs),
          listOrdersSince(tenantId, from).catch(() => []),
          listItems(tenantId).catch(() => []),
          listCustomers(tenantId, 300).catch(() => []),
          listReservations(tenantId, 200).catch(() => []),
          fetchTickets(tenantId),
        ])
        if (!alive) return
        setData({ sessions, orders, items, customers, reservations, tickets })
      } catch (e) {
        if (alive) setErr(e?.message || String(e))
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, allowed, fromMs, toMs])

  const sessions = data ? data.sessions : []

  const steps = useMemo(() => funnel(sessions), [sessions])
  const drops = useMemo(() => dropOffPoints(sessions), [sessions])
  const itemRows = useMemo(() => itemInterest(sessions, data ? data.items : []), [sessions, data])
  const cohortList = useMemo(() => cohorts(sessions, data ? data.orders : []), [sessions, data])
  const over = useMemo(() => overview(sessions), [sessions])
  const searches = useMemo(() => searchStats(sessions), [sessions])
  const segments = useMemo(() => buildSegments(sessions, itemRows), [sessions, itemRows])
  const findings = useMemo(
    () => ruleFindings({ sessions, steps, drops, itemRows, cohortList, searches }),
    [sessions, steps, drops, itemRows, cohortList, searches],
  )

  const periodLabel = `${dayStamp(fromMs)} — ${dayStamp(toMs)}`

  // The snapshot is the ONLY thing the model ever sees. It is built from the
  // same computed figures rendered on the other tabs — never from raw documents.
  const snapshot = useMemo(() => (data ? aiSnapshot({
    sessions, orders: data.orders, items: data.items, customers: data.customers,
    steps, drops, itemRows, cohortList, segments, searches, over,
    periodLabel, venue: tenant?.name || '', currency,
  }) : null), [data, sessions, steps, drops, itemRows, cohortList, segments, searches, over, periodLabel, tenant, currency])

  const sources = useMemo(() => engineSources(), [])
  const sharedOff = !sources.funnel && !sources.itemInterest

  if (!allowed) {
    return (
      <div className="page bhv-page">
        <h2 className="page-title">{ar ? 'سلوك العملاء' : 'Customer behaviour'}</h2>
        <div className="bhv-warn"><Icon name="lock" size={15} /><span>{ar ? 'لا تملك صلاحية عرض التقارير.' : 'You lack the reports capability.'}</span></div>
      </div>
    )
  }

  return (
    <div className="page bhv-page">
      <div className="bhv-head">
        <h2 className="page-title">{ar ? 'سلوك العملاء' : 'Customer behaviour'}</h2>
        <div className="bhv-period">
          <div className="segmented">
            {PERIODS.map((p) => (
              <button key={p.key} className={periodKey === p.key ? 'active' : ''} onClick={() => setPeriodKey(p.key)}>
                {ar ? p.ar : p.en}
              </button>
            ))}
          </div>
          {periodKey === 'custom' && (
            <div className="bhv-period-custom">
              <input className="input" type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              <span className="bhv-period-label">—</span>
              <input className="input" type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </div>
          )}
        </div>
      </div>

      <div className="bhv-scroll-x">
        <div className="bhv-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`chip${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
              <Icon name={t.icon} size={14} /> {ar ? t.ar : t.en}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="bhv-warn"><Icon name="warning" size={15} /><span>{ar ? 'تعذّر تحميل البيانات: ' : 'Load failed: '}{err}</span></div>
      )}

      {!data ? <Spinner /> : (
        <>
          {sessions.length === 0 && (
            <div className="bhv-card">
              <span className="bhv-card-t"><Icon name="eye" size={17} /> {ar ? 'لم تُسجَّل أي جلسة بعد' : 'No sessions recorded yet'}</span>
              <p className="bhv-hint">
                {ar
                  ? 'هذه الشاشة تقرأ جلسات تصفّح حقيقية من منيو المنشأة. ما دام لم يتصفّح أحد المنيو بعد تفعيل التتبّع، ستبقى كل التبويبات فارغة — وهذا صحيح وليس عطلاً.'
                  : 'This page reads real browsing sessions. Nothing here is broken; there is simply no data yet.'}
              </p>
              <ul className="bhv-list">
                <li>{ar ? '«النظرة العامة»: مسار الشراء من فتح المنيو حتى إتمام الطلب، مع نسبة كل خطوة وحجم عينتها.' : 'Overview: the purchase funnel with per-step rates.'}</li>
                <li>{ar ? '«الأصناف والاهتمام»: لكل صنف كم شاهده وكم نظر إليه ومن شاهده ولم يطلبه.' : 'Items: views, dwell, and viewed-not-ordered.'}</li>
                <li>{ar ? '«رحلة الجلسة»: التسلسل الزمني الفعلي لكل زائر وأين توقّف.' : 'Journey: the real event timeline per visitor.'}</li>
                <li>{ar ? '«ملف الضيف»: قصة الضيف كاملة عبر كل زياراته، وما بحث عنه ولم يجده.' : 'Guest: the full story per guest.'}</li>
                <li>{ar ? '«الشرائح»: مقارنة تحويل من لعب لعبة أو استخدم العرض ثلاثي الأبعاد بمن لم يفعل.' : 'Cohorts: conversion per behaviour group.'}</li>
                <li>{ar ? '«المخطِّط الذكي»: خطط وحملات مبنية على هذه الأرقام وحدها.' : 'Planner: plans built only on these figures.'}</li>
              </ul>
              <p className="bhv-hint">
                {ar ? 'الفترة المعروضة: ' : 'Period: '}<b className="bhv-num">{periodLabel}</b>
                {' · '}
                {ar ? 'جرّب فترة أوسع إن كان التتبّع مفعّلاً منذ فترة.' : 'Try a wider period.'}
              </p>
            </div>
          )}

          {sessions.length >= MAX_SESSIONS && (
            <div className="bhv-warn">
              <Icon name="warning" size={15} />
              <span>
                {ar
                  ? `الفترة تحوي جلسات أكثر من الحد المقروء (${fmtNum(MAX_SESSIONS)} جلسة، الأحدث أولاً). كل الأرقام هنا محسوبة على هذه العيّنة فقط — ضيّق الفترة لقراءة أدق.`
                  : `Capped at the newest ${fmtNum(MAX_SESSIONS)} sessions. Narrow the period for a complete read.`}
              </span>
            </div>
          )}

          {sharedOff && sessions.length > 0 && (
            <div className="bhv-warn">
              <Icon name="warning" size={15} />
              <span>{ar ? 'محرّك التحليل المشترك غير متاح — تعمل هذه الشاشة بحساباتها الداخلية، والأرقام صحيحة لكن قد تختلف تسمياتها عن باقي النظام.' : 'Shared analysis engine unavailable; using the built-in calculations.'}</span>
            </div>
          )}

          {tab === 'overview' && <FunnelView steps={steps} drops={drops} over={over} ar={ar} sessions={sessions.length} />}

          {tab === 'items' && <ItemInterestTable rows={itemRows} sessions={sessions} ar={ar} />}

          {tab === 'journey' && <SessionTimeline sessions={sessions} ar={ar} />}

          {tab === 'guest' && (
            <GuestProfile
              sessions={sessions}
              orders={data.orders}
              customers={data.customers}
              reservations={data.reservations}
              tickets={data.tickets}
              ar={ar} currency={currency} lang={lang} showMoney={showMoney}
            />
          )}

          {tab === 'cohorts' && (
            <CohortView cohortList={cohortList} ar={ar} currency={currency} lang={lang} showMoney={showMoney} sessions={sessions.length} />
          )}

          {tab === 'ai' && (
            <AiPlanner
              snapshot={snapshot}
              segments={segments}
              itemRows={itemRows}
              findings={findings}
              guard={AI_PLANNER_GUARD_AR}
              ar={ar}
              allowed={aiAllowed}
              disabledReason={aiAllowed ? '' : (ar ? 'لا تملك صلاحية استخدام المساعد الذكي — الاستنتاجات وبناء الجمهور أدناه تعمل بدونه.' : 'You lack the assistant capability.')}
              periodLabel={periodLabel}
              onCreateCampaign={onCreateCampaign}
              onCreateContent={onCreateContent}
            />
          )}
        </>
      )}
    </div>
  )
}
