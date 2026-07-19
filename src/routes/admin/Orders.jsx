import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import OrderDetail from '../../components/OrderDetail.jsx'
import { watchOrdersSince } from '../../lib/db.js'
import { Price } from '../../components/Riyal.jsx'
import { orderNumber, timeAgo } from '../../lib/format.js'
import { sectionTemplate, templateOptions } from '../../lib/systemTemplates.js'

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// Tick hook for updating "time ago" strings
function useTick(ms = 10000) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), ms)
    return () => clearInterval(id)
  }, [ms])
  return tick
}

export default function Orders() {
  const { t, lang } = useI18n()
  const { tenantId, tenant } = useAuth()
  const ar = lang === 'ar'
  useTick() // refresh elapsed times

  const [orders, setOrders] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // all | active | paid | cancelled
  const [typeFilter, setTypeFilter] = useState('all') // all | dine_in | pickup | curbside
  const [activeOrderId, setActiveOrderId] = useState(null)
  // Orders layout template (kanban | grid | timeline) — plan-gated saved default,
  // switchable on the fly for this device.
  const [tpl, setTpl] = useState('kanban')

  useEffect(() => { setTpl(sectionTemplate(tenant, 'orders')) }, [tenant])

  useEffect(() => {
    if (!tenantId) return
    return watchOrdersSince(tenantId, startOfToday(), setOrders)
  }, [tenantId])

  // Deep-link (bell / search): ?order=<id> opens that order's detail sheet once
  // today's orders load, then clears the param. Unknown id → silently ignored.
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const want = params.get('order')
    if (!want || orders === null) return
    const p = new URLSearchParams(params); p.delete('order'); setParams(p, { replace: true })
    if (orders.some((o) => o.id === want)) setActiveOrderId(want)
  }, [params, orders])

  // Statistics calculations
  const stats = useMemo(() => {
    if (!orders) return { sales: 0, paidCount: 0, activeCount: 0, avgTicket: 0 }
    let sales = 0
    let paidCount = 0
    let activeCount = 0

    orders.forEach((o) => {
      if (o.status === 'paid') {
        sales += o.total || 0
        paidCount++
      } else if (!['cancelled', 'refunded'].includes(o.status)) {
        activeCount++
      }
    })

    return {
      sales,
      paidCount,
      activeCount,
      avgTicket: paidCount > 0 ? sales / paidCount : 0
    }
  }, [orders])

  // Filtered orders list
  const filteredOrders = useMemo(() => {
    if (!orders) return []
    return orders.filter((o) => {
      // 1. Search filter
      const matchSearch = search.trim() === '' || 
        o.code?.toLowerCase().includes(search.toLowerCase()) ||
        o.customerPhone?.includes(search) ||
        o.customerName?.toLowerCase().includes(search.toLowerCase()) ||
        o.tableLabel?.toLowerCase().includes(search.toLowerCase())

      // 2. Status filter
      let matchStatus = true
      if (statusFilter === 'active') {
        matchStatus = !['paid', 'cancelled', 'refunded'].includes(o.status)
      } else if (statusFilter === 'paid') {
        matchStatus = o.status === 'paid'
      } else if (statusFilter === 'cancelled') {
        matchStatus = ['cancelled', 'refunded'].includes(o.status)
      }

      // 3. Type filter
      const matchType = typeFilter === 'all' || o.orderType === typeFilter

      return matchSearch && matchStatus && matchType
    })
  }, [orders, search, statusFilter, typeFilter])

  const activeDeliveries = useMemo(() => (orders || []).filter((o) => o.orderType === 'delivery' && o.delivery && !['delivered', 'failed'].includes(o.delivery.status) && o.status !== 'cancelled'), [orders])

  if (orders === null) return <Spinner />

  const msOf = (o) => (o.createdAt?.toMillis ? o.createdAt.toMillis() : 0)
  const dateOf = (o) => (o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt))
  const fmtTime = (o) => dateOf(o).toLocaleTimeString(ar ? 'ar-SA-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
  const badgeFor = (o) => (o.status === 'paid' || o.status === 'ready' || o.status === 'served' ? 'badge-success' : ['cancelled', 'refunded'].includes(o.status) ? 'badge-danger' : 'badge-gold')
  const typeLabel = (o) => (o.orderType === 'dine_in' ? (o.tableLabel || (ar ? 'طاولة' : 'Table')) : o.orderType === 'curbside' ? (ar ? 'سيارة' : 'Car') : o.orderType === 'delivery' ? (ar ? 'توصيل' : 'Delivery') : o.orderType === 'pickup' ? (ar ? 'استلام' : 'Pickup') : (ar ? 'سفري' : 'Takeaway'))
  const itemsSummary = (o) => (o.items || []).map((it) => `${it.qty} × ${lang === 'en' && it.nameEn ? it.nameEn : it.nameAr}`).join(ar ? '، ' : ', ')

  // one card for grid (full) and kanban (compact)
  const renderOrderCard = (o, compact) => {
    const active = !['paid', 'cancelled', 'refunded'].includes(o.status)
    return (
      <div
        key={o.id}
        className="card card-pad stack hover-lift"
        style={{ gap: compact ? 6 : 10, cursor: 'pointer', borderColor: active ? 'var(--brand)' : undefined }}
        onClick={() => setActiveOrderId(o.id)}
      >
        <div className="row-between">
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <strong style={{ fontSize: 15 }}>#{orderNumber(o.code)}</strong>
            {o.rush && <span className="badge badge-danger" style={{ fontSize: 10 }}><Icon name="flame" size={11} style={{ verticalAlign: 'middle' }} /> {ar ? 'عاجل' : 'Rush'}</span>}
            <span className="badge" style={{ fontSize: 10, background: 'var(--surface-2)' }}>
              <Icon name={o.orderType === 'dine_in' ? 'tables' : o.orderType === 'curbside' ? 'car' : 'bag'} size={12} style={{ verticalAlign: 'middle' }} /> {typeLabel(o)}
            </span>
          </div>
          {!compact && <span className={`badge ${badgeFor(o)}`} style={{ fontSize: 10 }}>{t(`status_${o.status}`) || o.status}</span>}
        </div>

        <div className="xs muted" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '16px' }}>
          {itemsSummary(o)}
        </div>

        <div className="row-between" style={{ alignItems: 'center', borderTop: '1px dashed var(--border)', paddingTop: 6 }}>
          <span className="xs faint row" style={{ gap: 4, alignItems: 'center' }}>
            <Icon name="clock" size={11} />
            {timeAgo(dateOf(o), lang)}{o.customerName && !compact ? ` · ${o.customerName}` : ''}
          </span>
          <span className="pos-price" style={{ fontSize: 15 }}><Price value={o.total} currency={tenant?.currency || 'SAR'} lang={lang} /></span>
        </div>
      </div>
    )
  }

  return (
    <div className="page stack" style={{ gap: 'var(--sp-3)' }}>

      {/* Header */}
      <div className="row-between">
        <h2 className="page-title row" style={{ gap: 8 }}>
          <Icon name="orders" size={22} />
          {ar ? 'طلبات اليوم المباشرة' : 'Today\'s Live Orders'}
        </h2>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="badge badge-success" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flex: 'none' }} />
            {ar ? 'تحديث لحظي نشط' : 'Live updates active'}
          </span>
          <div className="pos-tpl-switch row" style={{ gap: 2, flex: 'none' }}>
            {templateOptions('orders').map((o) => (
              <button key={o.id} type="button" className={`icon-btn ${tpl === o.id ? 'active' : ''}`} title={ar ? `${o.ar}${o.hint ? ' — ' + o.hint : ''}` : o.en} onClick={() => setTpl(o.id)}>
                <Icon name={{ kanban: 'list', grid: 'grid', timeline: 'clock' }[o.id] || 'grid'} size={16} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Delivery dispatch — active deliveries + their drivers at a glance */}
      {activeDeliveries.length > 0 && (
        <div className="card card-pad stack" style={{ gap: 8, borderColor: 'var(--brand)' }}>
          <div className="row-between">
            <strong className="small row" style={{ gap: 6 }}><Icon name="car" size={16} /> {ar ? 'التوصيلات النشطة' : 'Active deliveries'}</strong>
            <span className="badge">{activeDeliveries.length}</span>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {activeDeliveries.map((o) => {
              const d = o.delivery || {}
              const dstat = { assigned: ar ? 'مُسند' : 'Assigned', picked_up: ar ? 'استُلم' : 'Picked up', on_way: ar ? 'في الطريق' : 'On the way' }[d.status] || (ar ? 'بانتظار مندوب' : 'Waiting')
              return (
                <button key={o.id} className="row-between" style={{ gap: 8, padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer', textAlign: 'start', width: '100%' }} onClick={() => setActiveOrderId(o.id)}>
                  <span className="small bold" style={{ flex: 'none' }}>#{o.code || o.id.slice(0, 5)} · {d.driverName || (ar ? 'بلا مندوب' : 'No driver')}</span>
                  <span className="xs faint grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.address || ''}</span>
                  <span className={`badge ${d.status === 'on_way' ? 'badge-info' : ''}`} style={{ flex: 'none' }}>{dstat}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Stats Row — same .stat-grid system as the dashboard */}
      <div className="stat-grid">
        <div className="stat">
          <div className="label">{ar ? 'مبيعات اليوم المحصلة' : 'Today\'s Sales'}</div>
          <div className="value price" style={{ color: 'var(--brand)' }}><Price value={stats.sales} currency={tenant?.currency || 'SAR'} lang={lang} /></div>
        </div>
        <div className="stat">
          <div className="label">{ar ? 'الطلبات المكتملة' : 'Completed (Paid)'}</div>
          <div className="value num">{stats.paidCount}</div>
        </div>
        <div className="stat">
          <div className="label">{ar ? 'طلبات قيد التحضير/الانتظار' : 'Active Orders'}</div>
          <div className="value num" style={{ color: 'var(--warning)' }}>{stats.activeCount}</div>
        </div>
        <div className="stat">
          <div className="label">{ar ? 'متوسط قيمة الفاتورة' : 'Avg. Ticket Value'}</div>
          <div className="value price"><Price value={stats.avgTicket} currency={tenant?.currency || 'SAR'} lang={lang} /></div>
        </div>
      </div>

      {/* Filters Panel */}
      <div className="card card-pad stack" style={{ gap: 12 }}>
        
        {/* Search */}
        <div className="row" style={{ gap: 8 }}>
          <div className="field grow" style={{ marginBottom: 0 }}>
            <div style={{ position: 'relative' }}>
              <input 
                className="input" 
                style={{ paddingInlineStart: 36 }}
                placeholder={ar ? 'ابحث برقم الطلب، رقم الهاتف، أو اسم العميل...' : 'Search by code, phone, client...'} 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Icon name="search" size={16} style={{ position: 'absolute', top: 12, insetInlineStart: 12, opacity: 0.5 }} />
              {search && (
                <button 
                  onClick={() => setSearch('')}
                  style={{ position: 'absolute', top: 8, insetInlineEnd: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Filters Selectors */}
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
          
          {/* Status Segment */}
          <div className="stack" style={{ gap: 4 }}>
            <span className="xs muted">{ar ? 'حالة الدفع/التحضير:' : 'Order status:'}</span>
            <div className="segmented">
              <button className={statusFilter === 'all' ? 'active' : ''} onClick={() => setStatusFilter('all')}>{ar ? 'الكل' : 'All'}</button>
              <button className={statusFilter === 'active' ? 'active' : ''} onClick={() => setStatusFilter('active')}>{ar ? 'النشطة' : 'Active'}</button>
              <button className={statusFilter === 'paid' ? 'active' : ''} onClick={() => setStatusFilter('paid')}>{ar ? 'المدفوعة' : 'Paid'}</button>
              <button className={statusFilter === 'cancelled' ? 'active' : ''} onClick={() => setStatusFilter('cancelled')}>{ar ? 'الملغاة' : 'Cancelled'}</button>
            </div>
          </div>

          {/* Type Segment */}
          <div className="stack" style={{ gap: 4 }}>
            <span className="xs muted">{ar ? 'نوع الاستلام:' : 'Order type:'}</span>
            <div className="segmented">
              <button className={typeFilter === 'all' ? 'active' : ''} onClick={() => setTypeFilter('all')}>{ar ? 'الكل' : 'All'}</button>
              <button className={typeFilter === 'dine_in' ? 'active' : ''} onClick={() => setTypeFilter('dine_in')}>{ar ? 'في المكان' : 'Dine-In'}</button>
              <button className={typeFilter === 'pickup' ? 'active' : ''} onClick={() => setTypeFilter('pickup')}>{ar ? 'استلام' : 'Pickup'}</button>
              <button className={typeFilter === 'curbside' ? 'active' : ''} onClick={() => setTypeFilter('curbside')}>{ar ? 'سيارة' : 'Curbside'}</button>
            </div>
          </div>

        </div>

      </div>

      {/* Orders — kanban | grid | timeline */}
      {filteredOrders.length === 0 ? (
        <Empty
          icon="orders"
          title={ar ? 'لا توجد طلبات مطابقة' : 'No matching orders'}
          hint={ar ? 'جرب تغيير خيارات التصفية أو البحث' : 'Try changing search query or filter options'}
        />
      ) : tpl === 'timeline' ? (
        /* timeline: dense chronological feed, newest first */
        <div className="card divide" style={{ padding: '0 var(--sp-3)' }}>
          {[...filteredOrders].sort((a, b) => msOf(b) - msOf(a)).map((o) => (
            <button key={o.id} type="button" className="ord-tl-row" onClick={() => setActiveOrderId(o.id)}>
              <span className="xs faint num" style={{ flex: 'none', minWidth: 52 }}>{fmtTime(o)}</span>
              <span className="bold" style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>#{orderNumber(o.code)}{o.rush && <Icon name="flame" size={12} style={{ color: 'var(--danger)' }} />}</span>
              <span className={`badge ${badgeFor(o)}`} style={{ fontSize: 10, flex: 'none' }}>{t(`status_${o.status}`) || o.status}</span>
              <span className="xs muted grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'start' }}>
                {typeLabel(o)}{o.customerName ? ` · ${o.customerName}` : ''} · {itemsSummary(o)}
              </span>
              <span className="pos-price" style={{ flex: 'none' }}><Price value={o.total} currency={tenant?.currency || 'SAR'} lang={lang} /></span>
            </button>
          ))}
        </div>
      ) : tpl === 'kanban' ? (
        /* kanban: columns by status, oldest first inside each — operations flow */
        <div className="ord-lanes">
          {[
            ['pending', ar ? 'بانتظار القبول' : 'Pending', 'warning'],
            ['accepted', ar ? 'مقبولة' : 'Accepted', 'info'],
            ['preparing', ar ? 'قيد التحضير' : 'Preparing', 'brand'],
            ['ready', ar ? 'جاهزة' : 'Ready', 'success'],
            ['done', ar ? 'منتهية' : 'Done', ''],
          ].map(([st, lbl, tone]) => {
            const lane = filteredOrders
              .filter((o) => (st === 'done' ? ['paid', 'served', 'cancelled', 'refunded'].includes(o.status) : o.status === st))
              .sort((a, b) => (st === 'done' ? msOf(b) - msOf(a) : msOf(a) - msOf(b)))
            return (
              <section key={st} className="ord-lane" data-tone={tone}>
                <div className="kds-lane-head"><strong>{lbl}</strong><span className="badge">{lane.length}</span></div>
                <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                  {lane.map((o) => renderOrderCard(o, true))}
                  {lane.length === 0 && <p className="xs faint" style={{ textAlign: 'center', padding: 'var(--sp-2)' }}>—</p>}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        /* grid: detailed cards */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {filteredOrders.map((o) => renderOrderCard(o, false))}
        </div>
      )}

      {/* Order Detail Overlay Sheet */}
      {activeOrderId && (
        <OrderDetail 
          tid={tenantId} 
          orderId={activeOrderId} 
          currency={tenant?.currency || 'SAR'} 
          staffActions 
          onClose={() => setActiveOrderId(null)} 
        />
      )}

    </div>
  )
}
