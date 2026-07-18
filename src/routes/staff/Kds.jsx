import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n, pickLang } from '../../lib/i18n.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { watchActiveOrders, watchOrdersSince, watchCategories, watchItems, updateOrderStatus, setOrderLineDone } from '../../lib/db.js'
import { orderNumber, minutesSince } from '../../lib/format.js'
import { alertParty } from '../../lib/notify.js'
import StaffBell from '../../components/StaffBell.jsx'
import Icon from '../../components/Icon.jsx'
import { useCompactUI } from '../../lib/useCompactUI.js'
import { sectionTemplate, templateOptions } from '../../lib/systemTemplates.js'
import { systemThemeAttr, useSystemThemeBody } from '../../lib/systemThemes.js'
import PinLock from '../../components/PinLock.jsx'
import AppBackground from '../../components/AppBackground.jsx'
import { requestLock } from '../../lib/pin.js'

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

// Live wall clock — isolated so its 1s tick never re-renders the board.
function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])
  return <span className="kds-clock" dir="ltr">{now.toLocaleTimeString('en-GB')}</span>
}

// Re-render every 15s so elapsed-minute timers stay honest.
function useTick(ms = 15000) {
  const [, setTick] = useState(0)
  useEffect(() => { const id = setInterval(() => setTick((x) => x + 1), ms); return () => clearInterval(id) }, [ms])
}

export default function Kds() {
  useCompactUI()
  const { t, lang, toggleTheme, theme } = useI18n()
  const { tenantId, tenant } = useAuth()
  const ar = lang === 'ar'
  useSystemThemeBody(tenant, 'kds')
  const [orders, setOrders] = useState(null) // active: pending/accepted/preparing/ready
  const [today, setToday] = useState([]) // everything since midnight → bumped count + avg prep
  const [cats, setCats] = useState([])
  const [items, setItems] = useState([]) // menu items → allergy warnings + station fallback
  // KDS layout template (rail | kanban | grid | display) — tenant's saved choice
  // is plan-gated (Pro+); kitchen staff can switch on the fly for this device.
  const [tpl, setTpl] = useState('rail')
  const [events, setEvents] = useState([]) // live activity feed (client-side, this screen)
  const prevCount = useRef(0)
  const seeded = useRef(false)
  const prevStatus = useRef(null) // Map(id → {status, code}) for the activity diff
  useTick()

  // resync ONLY when the saved template value changes — any other tenant write
  // (a studio tweak, counters) must not snap back a manually chosen board
  const savedTpl = sectionTemplate(tenant, 'kds')
  useEffect(() => { setTpl(savedTpl) }, [savedTpl])
  useEffect(() => { if (!tenantId) return; return watchActiveOrders(tenantId, setOrders) }, [tenantId])
  useEffect(() => { if (!tenantId) return; return watchOrdersSince(tenantId, startOfToday(), setToday) }, [tenantId])
  useEffect(() => { if (!tenantId) return; return watchCategories(tenantId, setCats) }, [tenantId])
  useEffect(() => { if (!tenantId) return; return watchItems(tenantId, setItems) }, [tenantId])

  // Alert kitchen when a new ticket (accepted/preparing) appears.
  useEffect(() => {
    if (!orders) return
    const n = orders.filter((o) => ['accepted', 'preparing'].includes(o.status)).length
    if (seeded.current && n > prevCount.current) {
      alertParty({ title: lang === 'ar' ? 'تذكرة جديدة' : 'New ticket', body: lang === 'ar' ? 'طلب للتحضير' : 'Order to prepare', tag: 'kds', url: '/kds' })
    }
    prevCount.current = n
    seeded.current = true
  }, [orders, lang])

  // Activity feed: diff statuses between snapshots (skips the initial seed).
  useEffect(() => {
    if (!orders) return
    const now = new Date().toLocaleTimeString(ar ? 'ar-SA-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
    const cur = new Map(orders.map((o) => [o.id, { status: o.status, code: o.code }]))
    const prev = prevStatus.current
    prevStatus.current = cur
    if (!prev) return
    const evs = []
    cur.forEach((v, id) => {
      const was = prev.get(id)
      if (!was) evs.push({ key: `${id}:${v.status}:${now}`, code: orderNumber(v.code), text: t(`status_${v.status}`) || v.status, at: now })
      else if (was.status !== v.status) evs.push({ key: `${id}:${v.status}:${now}`, code: orderNumber(v.code), text: t(`status_${v.status}`) || v.status, at: now })
    })
    prev.forEach((v, id) => { if (!cur.has(id)) evs.push({ key: `${id}:out:${now}`, code: orderNumber(v.code), text: ar ? 'اكتمل' : 'Done', at: now }) })
    if (evs.length) setEvents((e) => [...evs, ...e].slice(0, 8))
  }, [orders]) // eslint-disable-line react-hooks/exhaustive-deps

  if (orders === null) return <Spinner />

  const ms = (o) => (o.createdAt?.toMillis ? o.createdAt.toMillis() : 0)
  const pendingQ = orders.filter((o) => o.status === 'pending').sort((a, b) => ms(a) - ms(b))
  // rush first, then oldest — the fire lane jumps the queue
  const tickets = orders.filter((o) => ['accepted', 'preparing'].includes(o.status)).sort((a, b) => ((b.rush ? 1 : 0) - (a.rush ? 1 : 0)) || (ms(a) - ms(b)))
  const itemById = {}
  items.forEach((it) => { itemById[it.id] = it })

  // venue-tuned SLA: late at kdsSla minutes (default 10), warn at half of it
  const sla = Math.max(2, Number(tenant?.kdsSla) || 10)
  const warnAt = Math.max(1, Math.round(sla / 2))
  // station name: the venue's category→station mapping, else the category name
  const stationOf = (catId) => {
    const mapped = (tenant?.kdsStations?.[catId] || '').trim()
    if (mapped) return mapped
    const c = cats.find((x) => x.id === catId)
    return c ? pickLang(c, 'name', lang) : ''
  }
  const readyList = orders.filter((o) => o.status === 'ready').sort((a, b) => ms(a) - ms(b))
  const accepted = tickets.filter((o) => o.status === 'accepted')
  const preparing = tickets.filter((o) => o.status === 'preparing')
  const overdue = tickets.filter((o) => minutesSince(o.createdAt) >= sla)
  const oldestLate = overdue.length ? Math.max(...overdue.map((o) => minutesSince(o.createdAt))) : 0

  // tonight's throughput: orders whose history shows they reached "ready"
  const bumpedToday = today.filter((o) => (o.statusHistory || []).some((h) => h.status === 'ready'))
  const prepMins = bumpedToday.map((o) => {
    const hist = o.statusHistory || []
    const readyAt = hist.find((h) => h.status === 'ready')?.at
    const startAt = hist.find((h) => h.status === 'accepted')?.at || ms(o)
    const mins = readyAt && startAt ? (readyAt - startAt) / 60000 : null
    return mins !== null && mins >= 0 && mins < 240 ? mins : null
  }).filter((x) => x !== null)
  const avgPrep = prepMins.length ? Math.round(prepMins.reduce((s, x) => s + x, 0) / prepMins.length) : null

  // station load ≈ open line units per station (venue mapping, else category)
  const loadByName = {}
  tickets.forEach((o) => (o.items || []).forEach((l) => {
    const name = stationOf(l.categoryId || itemById[l.itemId]?.categoryId) || (ar ? 'أخرى' : 'Other')
    loadByName[name] = (loadByName[name] || 0) + (Number(l.qty) || 1)
  }))
  const stations = Object.entries(loadByName).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 5)
  const maxLoad = Math.max(...stations.map((s) => s.n), 1)

  const accept = (o) => updateOrderStatus(tenantId, o.id, 'accepted')
  const serve = (o) => updateOrderStatus(tenantId, o.id, 'served')
  const recall = (o) => updateOrderStatus(tenantId, o.id, 'preparing')

  // One renderer for every template. In mixed views (rail/grid/display) the
  // tickets of both statuses share one surface, so a status chip is shown —
  // the bump button label alone shouldn't be the only state signal.
  // Each line is tappable: expo strikes items one by one (order.doneLines map).
  const renderTicket = (o, next, label, cls, showStatus = false) => {
    const mins = minutesSince(o.createdAt)
    const ageCls = mins >= sla ? 'age-late' : mins >= warnAt ? 'age-warn' : ''
    const lines = o.items || []
    const allDone = lines.length > 0 && lines.every((_, i) => o.doneLines?.[i])
    return (
      <div key={o.id} className={`kds-ticket ${ageCls} ${o.rush ? 'is-rush' : ''}`}>
        <div className="kds-ticket-head">
          <strong>{orderNumber(o.code)}</strong>
          {o.rush && <span className="kds-rush"><Icon name="flame" size={11} /> {lang === 'ar' ? 'عاجل' : 'Rush'}</span>}
          {showStatus && <span className={`kds-status ${o.status === 'preparing' ? 'cooking' : ''}`}>{o.status === 'preparing' ? (lang === 'ar' ? 'تحضير' : 'Cooking') : (lang === 'ar' ? 'جديدة' : 'New')}</span>}
          <span className="kds-timer">{mins}{lang === 'ar' ? 'د' : 'm'}</span>
        </div>
        <div className="kds-where">{o.tableLabel || t('takeaway')}{o.partySize ? ` · ${o.partySize}` : ''}</div>
        <div className="kds-items">
          {lines.map((l, i) => {
            const done = !!o.doneLines?.[i]
            const item = itemById[l.itemId]
            const station = stationOf(l.categoryId || item?.categoryId)
            const warn = item?.kdsWarning
            return (
              <div key={i} role="button" tabIndex={0} className={`kds-item kds-line ${done ? 'kds-done' : ''}`}
                title={lang === 'ar' ? 'اضغط لشطب السطر' : 'Tap to strike this line'}
                onClick={() => setOrderLineDone(tenantId, o.id, i, !done)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOrderLineDone(tenantId, o.id, i, !done) } }}>
                <span className="kds-qty">{l.qty}</span>
                <div className="kds-item-body">
                  <span className="kds-name">{lang === 'en' && l.nameEn ? l.nameEn : l.nameAr}{l.variantLabel ? ` · ${l.variantLabel}` : ''}</span>
                  {warn ? <div className="kds-warn"><Icon name="warning" size={14} /> {warn}</div> : null}
                  {l.modifiers?.length ? <div className="kds-mods">{l.modifiers.map((m) => (lang === 'en' && m.nameEn ? m.nameEn : m.nameAr)).join(' · ')}</div> : null}
                  {l.note ? <div className="kds-note" style={{ marginTop: 3 }}>{l.note}</div> : null}
                </div>
                {station ? <span className="kds-station">{station}</span> : null}
              </div>
            )
          })}
        </div>
        {o.notes && <div className="kds-note">{o.notes}</div>}
        <button className={`btn kds-bump ${cls} ${allDone ? 'all-done' : ''}`} onClick={() => updateOrderStatus(tenantId, o.id, next)}>{allDone ? <Icon name="check" size={15} /> : null}{label}</button>
      </div>
    )
  }

  // Ready ticket (expo): struck-through items + served / recall.
  const renderReady = (o) => (
    <div key={o.id} className="kds-ticket is-ready">
      <div className="kds-ticket-head">
        <strong>{orderNumber(o.code)}</strong>
        <span className="kds-timer">{minutesSince(o.createdAt)}{ar ? 'د' : 'm'}</span>
      </div>
      <div className="kds-where">{o.tableLabel || t('takeaway')}{o.partySize ? ` · ${o.partySize}` : ''}</div>
      <div className="kds-items">
        {(o.items || []).map((l, i) => (
          <div key={i} className="kds-item kds-done">
            <span className="kds-qty">{l.qty}</span>
            <div className="kds-item-body"><span className="kds-name">{lang === 'en' && l.nameEn ? l.nameEn : l.nameAr}{l.variantLabel ? ` · ${l.variantLabel}` : ''}</span></div>
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 6, marginTop: 'auto' }}>
        <button className="btn btn-outline" style={{ flex: 'none' }} onClick={() => recall(o)} title={ar ? 'استرجاع للتحضير' : 'Recall to prep'}><Icon name="undo" size={15} /></button>
        <button className="btn btn-success grow kds-bump" style={{ marginTop: 0 }} onClick={() => serve(o)}><Icon name="check" size={15} /> {ar ? 'قُدّم' : 'Served'}</button>
      </div>
    </div>
  )

  const boardEmpty = tickets.length === 0 && readyList.length === 0

  return (
    <div className="kds-shell" data-theme={tpl === 'display' ? 'dark' : undefined} data-systheme={systemThemeAttr(tenant, 'kds')}>
      <AppBackground tenant={tenant} />
      <PinLock tenant={tenant} tenantId={tenantId} />
      <header className="app-bar">
        <Link to="/cashier" className="icon-btn"><Icon name="back" /></Link>
        <strong style={{ fontSize: 'var(--fs-md)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="kitchen" size={18} /> {t('kitchen')}</strong>
        <span className="badge badge-success" style={{ fontSize: 10 }}>● {ar ? 'مباشر' : 'Live'}</span>
        <div className="grow" />
        <Clock />
        <div className="pos-tpl-switch row" style={{ gap: 2, flex: 'none' }}>
          {templateOptions('kds').map((o) => (
            <button key={o.id} type="button" className={`icon-btn ${tpl === o.id ? 'active' : ''}`} title={lang === 'ar' ? `${o.ar}${o.hint ? ' — ' + o.hint : ''}` : o.en} onClick={() => setTpl(o.id)}>
              <Icon name={{ rail: 'ticket', kanban: 'list', grid: 'grid', display: 'eye' }[o.id] || 'grid'} size={16} />
            </button>
          ))}
        </div>
        {tenant?.pinLock?.enabled && <button className="icon-btn" onClick={requestLock} title={ar ? 'قفل الشاشة الآن' : 'Lock now'}><Icon name="key" size={18} /></button>}
        <StaffBell tenantId={tenantId} />
        <button className="icon-btn" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
      </header>

      {/* service pulse: is the kitchen keeping up? */}
      <div className="kds-kpis">
        <div className="kds-kpi" data-tone={overdue.length ? 'danger' : 'success'}>
          <span className="kds-kpi-num num">{overdue.length}</span>
          <span className="xs">{overdue.length ? (ar ? `متأخرة · الأقدم ${oldestLate}د` : `Overdue · oldest ${oldestLate}m`) : (ar ? 'لا تأخير' : 'On track')}</span>
        </div>
        <div className="kds-kpi" data-tone="brand">
          <span className="kds-kpi-num num">{tickets.length}</span>
          <span className="xs">{ar ? `قيد العمل · جديدة ${accepted.length} · تحضير ${preparing.length}` : `Working · new ${accepted.length} · prep ${preparing.length}`}</span>
        </div>
        <div className="kds-kpi" data-tone="success">
          <span className="kds-kpi-num num">{readyList.length}</span>
          <span className="xs">{ar ? 'جاهزة للتقديم' : 'Ready to serve'}</span>
        </div>
        <div className="kds-kpi">
          <span className="kds-kpi-num num">{bumpedToday.length}</span>
          <span className="xs">{ar ? `أُنجزت اليوم${avgPrep !== null ? ` · متوسط ${avgPrep}د` : ''}` : `Done today${avgPrep !== null ? ` · avg ${avgPrep}m` : ''}`}</span>
        </div>
      </div>

      <div className="kds-pro-body">
        <main className="kds-wrap" data-template={tpl}>
          {/* incoming queue INLINE — the side rail is hidden under 1000px (portrait
              tablets), and accepting new orders must never be unreachable there */}
          {pendingQ.length > 0 && (
            <div className="kds-queue-inline">
              <span className="small bold" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none' }}><Icon name="clock" size={15} style={{ color: 'var(--info)' }} /> {ar ? 'قادم' : 'Incoming'} ({pendingQ.length})</span>
              {pendingQ.map((o) => (
                <div key={o.id} className="kds-queue-chip">
                  <strong className="small">{orderNumber(o.code)}</strong>
                  <span className="xs faint">{o.tableLabel || t('takeaway')} · {minutesSince(o.createdAt)}{ar ? 'د' : 'm'}</span>
                  <button className="btn btn-sm btn-primary" style={{ minHeight: 44 }} onClick={() => accept(o)}>{ar ? 'قبول' : 'Accept'}</button>
                </div>
              ))}
            </div>
          )}

          {/* ready strip (mixed templates) — expo actions always one tap away */}
          {tpl !== 'kanban' && readyList.length > 0 && (
            <div className="kds-ready-strip">
              {readyList.map((o) => (
                <div key={o.id} className="kds-ready-chip">
                  <strong>{orderNumber(o.code)}</strong>
                  <span className="xs faint">{o.tableLabel || t('takeaway')}</span>
                  {/* expo actions: full 44px tap targets (greasy kitchen fingers) */}
                  <button className="icon-btn" style={{ width: 44, height: 44 }} onClick={() => recall(o)} title={ar ? 'استرجاع' : 'Recall'}><Icon name="undo" size={16} /></button>
                  <button className="btn btn-success" style={{ minHeight: 44, fontWeight: 800 }} onClick={() => serve(o)}>{ar ? 'قُدّم' : 'Served'}</button>
                </div>
              ))}
            </div>
          )}

          {boardEmpty ? (
            <Empty icon="kitchen" title={lang === 'ar' ? 'لا تذاكر للتحضير' : 'No tickets to prepare'} />
          ) : tpl === 'kanban' ? (
            <div className="kds-lanes" data-cols="3">
              <section className="kds-lane">
                <div className="kds-lane-head"><strong>{lang === 'ar' ? 'جديدة' : 'New'}</strong><span className="badge">{accepted.length}</span></div>
                <div className="kds-lane-body">{accepted.map((o) => renderTicket(o, 'preparing', t('startPreparing'), 'btn-primary'))}</div>
              </section>
              <section className="kds-lane">
                <div className="kds-lane-head"><strong>{lang === 'ar' ? 'قيد التحضير' : 'Cooking'}</strong><span className="badge">{preparing.length}</span></div>
                <div className="kds-lane-body">{preparing.map((o) => renderTicket(o, 'ready', t('markReady'), 'btn-success'))}</div>
              </section>
              <section className="kds-lane">
                <div className="kds-lane-head"><strong>{lang === 'ar' ? 'جاهزة' : 'Ready'}</strong><span className="badge">{readyList.length}</span></div>
                <div className="kds-lane-body">{readyList.map((o) => renderReady(o))}</div>
              </section>
            </div>
          ) : (
            // rail / grid / display: one mixed surface, oldest first — the next
            // ticket to work on is always at the start of the line.
            <div className={tpl === 'rail' ? 'kds-rail' : 'kds-grid'}>
              {tickets.map((o) => (o.status === 'accepted'
                ? renderTicket(o, 'preparing', t('startPreparing'), 'btn-primary', true)
                : renderTicket(o, 'ready', t('markReady'), 'btn-success', true)))}
            </div>
          )}
        </main>

        {/* side rail: queue → load → activity (hidden on small screens) */}
        <aside className="kds-side">
          <div className="kds-side-card">
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <Icon name="clock" size={14} style={{ color: 'var(--info)' }} />
              <strong className="small">{ar ? 'الطابور القادم' : 'Incoming queue'}</strong>
              <span className="badge" style={{ marginInlineStart: 'auto' }}>{pendingQ.length}</span>
            </div>
            {pendingQ.length === 0 ? <p className="xs faint" style={{ margin: 0 }}>{ar ? 'لا طلبات بالانتظار' : 'Nothing waiting'}</p> : pendingQ.map((o) => (
              <div key={o.id} className="row" style={{ gap: 6, alignItems: 'center' }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small bold">{orderNumber(o.code)} <span className="xs faint">· {(o.items || []).reduce((s, l) => s + (Number(l.qty) || 1), 0)} {ar ? 'صنف' : 'items'}</span></div>
                  <div className="xs faint">{o.tableLabel || t('takeaway')} · {minutesSince(o.createdAt)}{ar ? 'د' : 'm'}</div>
                </div>
                <button className="btn btn-sm btn-primary" style={{ flex: 'none', minHeight: 44 }} onClick={() => accept(o)}>{ar ? 'قبول' : 'Accept'}</button>
              </div>
            ))}
          </div>

          {stations.length > 0 && (
            <div className="kds-side-card">
              <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                <Icon name="flame" size={14} style={{ color: 'var(--warning)' }} />
                <strong className="small">{ar ? 'حمل الأقسام' : 'Station load'}</strong>
              </div>
              {stations.map((s) => (
                <div key={s.name} className="stack" style={{ gap: 3 }}>
                  <div className="row-between xs"><span>{s.name}</span><span className="num bold">{s.n}</span></div>
                  <div className="kds-load-bar"><span data-tone={s.n >= 8 ? 'danger' : s.n >= 4 ? 'warning' : 'success'} style={{ width: `${Math.round((s.n / maxLoad) * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          )}

          <div className="kds-side-card">
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <Icon name="trending" size={14} style={{ color: 'var(--success)' }} />
              <strong className="small">{ar ? 'النشاط' : 'Activity'}</strong>
              <span className="badge badge-success" style={{ marginInlineStart: 'auto', fontSize: 9 }}>{ar ? 'مباشر' : 'Live'}</span>
            </div>
            {events.length === 0 ? <p className="xs faint" style={{ margin: 0 }}>{ar ? 'يبدأ التسجيل مع أول حركة' : 'Starts with the first change'}</p> : events.map((e) => (
              <div key={e.key} className="row xs" style={{ gap: 6, alignItems: 'center' }}>
                <span className="faint num" style={{ flex: 'none' }}>{e.at}</span>
                <span className="bold">{e.code}</span>
                <span className="faint">{e.text}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}
