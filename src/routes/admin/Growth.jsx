// «النمو» — five revenue features over data the system already collects.
//
// Every tab here obeys the same contract: show the finding, show the sample it
// was computed from, and refuse outright when the sample cannot carry it. There
// is no projected-revenue figure anywhere on this page, because we do not know
// what an offer will earn until it has run.
//
// Actions never write. They hand a prefilled DRAFT to the existing Offers /
// Campaigns pages via props, and a human presses save there.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { Spinner } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { CAP } from '../../lib/permissions.js'
import { collection, getDocs, query, orderBy, limit as fbLimit, where } from 'firebase/firestore'
import { db } from '../../lib/firebase.js'
import {
  listOrdersSince, listItems, listCategories, listCustomers, listMaterials, listOffers,
} from '../../lib/db.js'
import { lex } from '../../lib/venueTypes.js'
import { menuHealth } from '../../lib/growth.js'

import UpsellPanel from '../../components/growth/UpsellPanel.jsx'
import AbandonedPanel from '../../components/growth/AbandonedPanel.jsx'
import QuietHoursPanel from '../../components/growth/QuietHoursPanel.jsx'
import MenuHealthPanel from '../../components/growth/MenuHealthPanel.jsx'
import ReorderPanel from '../../components/growth/ReorderPanel.jsx'
import { GRefusal } from '../../components/growth/parts.jsx'
import '../../styles/growth.css'

const ORDER_DAYS = 90        // co-occurrence and habits need history
const SESSION_DAYS = 14      // abandoned carts are only actionable while warm
const MAX_SESSIONS = 800

const TABS = [
  { key: 'upsell', icon: 'layers', ar: 'يُطلب معه', en: 'Ordered with' },
  { key: 'abandoned', icon: 'cart', ar: 'السلة المتروكة', en: 'Abandoned carts' },
  { key: 'quiet', icon: 'clock', ar: 'الساعات الهادئة', en: 'Quiet hours' },
  { key: 'health', icon: 'chartBar', ar: 'صحة المنيو', en: 'Menu health' },
  { key: 'reorder', icon: 'repeat', ar: 'إعادة الطلب', en: 'Reorder' },
]

// Bounded, newest-first, degrading progressively — a missing index or a strict
// rule must cost us sessions, not blank the page. Same shape Behavior.jsx uses.
async function fetchSessions(tid, fromMs) {
  const rowsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const ref = collection(db, 'tenants', tid, 'sessions')
  const inWindow = (s) => Number(s.startedAt) >= fromMs
  try {
    return { rows: rowsOf(await getDocs(query(ref, where('startedAt', '>=', fromMs), orderBy('startedAt', 'desc'), fbLimit(MAX_SESSIONS)))).filter(inWindow), err: '' }
  } catch (_) { /* index or rule issue — try simpler shapes */ }
  try {
    return { rows: rowsOf(await getDocs(query(ref, orderBy('startedAt', 'desc'), fbLimit(MAX_SESSIONS)))).filter(inWindow), err: '' }
  } catch (_) { /* fall through */ }
  try {
    return { rows: rowsOf(await getDocs(query(ref, fbLimit(MAX_SESSIONS)))).filter(inWindow), err: 'partial' }
  } catch (_) {
    return { rows: [], err: 'denied' }
  }
}

/**
 * @param {function} onCreateOffer     (draft) => void — shape matches
 *        Offers.jsx openNewFromDraft(): { name, type, value, itemIds, window }
 * @param {function} onCreateCampaign  (draft) => void — shape matches
 *        Campaigns.jsx: { title, text, purpose, audience: { phones: [] } }
 */
export default function Growth({ onCreateOffer, onCreateCampaign }) {
  const { lang } = useI18n()
  const ar = lang !== 'en'
  const { tenantId, tenant, isManager, can } = useAuth()
  const navigate = useNavigate()
  const currency = tenant?.currency || 'SAR'

  const [tab, setTab] = useState('upsell')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  const allowed = isManager || can(CAP.VIEW_REPORTS)

  useEffect(() => {
    if (!tenantId || !allowed) return
    let alive = true
    setData(null)
    setErr('')
    ;(async () => {
      try {
        const since = new Date(Date.now() - ORDER_DAYS * 86400000)
        const sessSince = Date.now() - SESSION_DAYS * 86400000
        // Sessions are optional: a venue may not track, or the role may not read
        // them. That must degrade one tab, never the page.
        const [orders, items, categories, customers, materials, offers, sess] = await Promise.all([
          listOrdersSince(tenantId, since).catch(() => []),
          listItems(tenantId).catch(() => []),
          listCategories(tenantId).catch(() => []),
          listCustomers(tenantId, 400).catch(() => []),
          listMaterials(tenantId).catch(() => []),
          listOffers(tenantId).catch(() => []),
          fetchSessions(tenantId, sessSince),
        ])
        if (!alive) return
        setData({
          orders: orders || [], items: items || [], categories: categories || [],
          customers: customers || [], materials: materials || [], offers: offers || [],
          sessions: sess.rows, sessionsErr: sess.err,
        })
      } catch (e) {
        if (alive) setErr(String(e?.message || e))
      }
    })()
    return () => { alive = false }
  }, [tenantId, allowed])

  // Computed once here so the health tab and the tab badges agree.
  const health = useMemo(() => (data ? menuHealth({
    items: data.items, categories: data.categories, orders: data.orders, materials: data.materials, lang,
  }) : null), [data, lang])

  const openItem = (itemId) => navigate(`/admin/items?item=${encodeURIComponent(itemId)}`)

  if (!allowed) {
    return (
      <div className="page stack">
        <GRefusal
          icon="lock"
          title={ar ? 'لا تملك صلاحية التقارير' : 'Reports permission required'}
          body={ar ? 'هذه الصفحة تعرض أرقام مبيعات وسلوك ضيوف، وتتطلب صلاحية «التقارير».' : 'This page shows sales and guest-behaviour figures and requires the reports capability.'}
        />
      </div>
    )
  }

  if (err) {
    return (
      <div className="page stack">
        <GRefusal icon="warning" title={ar ? 'تعذّر تحميل البيانات' : 'Could not load data'} body={err} />
      </div>
    )
  }
  if (!data) return <Spinner lg />

  const itemsWord = lex(tenant, 'items')

  return (
    <div className="page stack growth">
      <div className="row-between">
        <h2 className="page-title">{ar ? 'النمو' : 'Growth'}</h2>
      </div>

      <p className="g-basis">
        {ar
          ? `كل رقم في هذه الصفحة محسوب من طلبات منشأتك وجلسات ضيوفها: ${data.orders.length} طلباً خلال ${ORDER_DAYS} يوماً، ${data.sessions.length} جلسة خلال ${SESSION_DAYS} يوماً، ${data.items.length} من ${itemsWord}. لا يوجد هنا أي رقم توقّعي ولا أي مقارنة بمتوسط سوق.`
          : `Every figure here is computed from your own orders and sessions: ${data.orders.length} orders over ${ORDER_DAYS} days, ${data.sessions.length} sessions over ${SESSION_DAYS} days, ${data.items.length} items. No projections, no market averages.`}
      </p>

      <div className="growth-tabs" role="tablist">
        {TABS.map((x) => (
          <button
            key={x.key}
            role="tab"
            aria-selected={tab === x.key}
            className={`growth-tab ${tab === x.key ? 'active' : ''}`}
            onClick={() => setTab(x.key)}
          >
            <Icon name={x.icon} size={14} />
            <span>{ar ? x.ar : x.en}</span>
            {x.key === 'health' && health?.score !== null && health?.score !== undefined && (
              <span className="gcount">{health.score}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'upsell' && (
        <UpsellPanel
          orders={data.orders} items={data.items}
          tenant={tenant} lang={lang} currency={currency} days={ORDER_DAYS}
        />
      )}

      {tab === 'abandoned' && (
        <AbandonedPanel
          sessions={data.sessions} orders={data.orders} customers={data.customers} items={data.items}
          tenant={tenant} lang={lang} currency={currency} days={SESSION_DAYS}
          sessionsLoadError={data.sessionsErr === 'denied' ? 'denied' : ''}
          onCreateCampaign={can(CAP.MANAGE_CAMPAIGNS) || isManager ? onCreateCampaign : undefined}
        />
      )}

      {tab === 'quiet' && (
        <QuietHoursPanel
          orders={data.orders} items={data.items} materials={data.materials} offers={data.offers}
          lang={lang} days={30}
          onCreateOffer={can(CAP.MANAGE_OFFERS) || isManager ? onCreateOffer : undefined}
        />
      )}

      {tab === 'health' && (
        <MenuHealthPanel
          health={health} lang={lang}
          onFixItem={can(CAP.MANAGE_MENU) || isManager ? openItem : undefined}
        />
      )}

      {tab === 'reorder' && (
        <ReorderPanel
          orders={data.orders} items={data.items}
          tenant={tenant} lang={lang} currency={currency}
        />
      )}
    </div>
  )
}
