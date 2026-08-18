// INCOMING WORK, CLAIMED ONCE. A guest order or waiter call raises one centered
// card on every staff screen at the same time. The only exits are: someone taps
// accept (a compare-and-set claim — exactly one winner, the card vanishes for
// everyone on the snapshot echo), or the staffer minimizes it to a persistent
// pill because they are mid-checkout. There is deliberately NO dismiss.
//
// Mounted once per shell (AdminLayout, Cashier, KDS, StaffLayout). A module
// guard keeps a second accidental mount silent instead of doubling the modal.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'
import { Price } from './Riyal.jsx'
import { useToast } from './Toast.jsx'
import { useActiveOrders, useOpenWaiterCalls } from '../lib/liveBoard.js'
import { claimOrder, claimWaiterCall } from '../lib/db.js'
import { isPosBusy, onPosBusy } from '../lib/alertsBus.js'
import { orderNumber, timeAgo, minutesSince } from '../lib/format.js'
import { callText } from '../lib/waiterCalls.js'
import { getPinActor } from '../lib/pin.js'
import { CAP } from '../lib/permissions.js'
import { isEmbedded } from '../lib/embedded.js'
import { playFromPrefs } from '../lib/sounds.js'
import { getPrefs } from '../lib/notifyPrefs.js'
import '../styles/incoming-alerts.css'

// Reactive single-instance election. Every shell mounts its own <IncomingAlerts/>,
// and React 18 keeps the OUTGOING shell's tree mounted while the incoming one
// mounts — so a plain "primary = (count===1) latched at mount" left the sole
// survivor stranded as non-primary (it latched false while both were briefly
// alive, then the other unmounted) and the alert modal vanished platform-wide
// until a reload. Instead every instance registers an id and RE-DERIVES primary
// (= lowest live id) whenever the live set changes.
let mountSeq = 0
const liveInstances = new Set()
const electionSubs = new Set()
function joinElection(id) {
  liveInstances.add(id)
  electionSubs.forEach((fn) => fn())
  return () => { liveInstances.delete(id); electionSubs.forEach((fn) => fn()) }
}
const isPrimaryId = (id) => liveInstances.size > 0 && Math.min(...liveInstances) === id

const RECHIME_MS = 45000
const MUTE_MS = 5 * 60 * 1000

export default function IncomingAlerts() {
  // NEVER inside a preview iframe: the Settings staff preview loads the REAL
  // /kds, so this modal rendered a fully-clickable «قبول الطلب» at 30% scale
  // inside a design preview — a manager could claim a live guest order by
  // mis-clicking a mockup (plus a duplicate chime from the second realm).
  if (isEmbedded) return null
  return <IncomingAlertsLive />
}

function IncomingAlertsLive() {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const { tenantId, tenant, profile, user, isManager, can } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const currency = tenant?.currency || 'SAR'

  // one live instance renders — but the election is REACTIVE (see joinElection):
  // the survivor of a shell→shell navigation always re-derives itself primary.
  const idRef = useRef(0)
  if (idRef.current === 0) idRef.current = ++mountSeq
  const [primary, setPrimary] = useState(() => isPrimaryId(idRef.current))
  useEffect(() => {
    const id = idRef.current
    const recompute = () => setPrimary(isPrimaryId(id))
    electionSubs.add(recompute)
    const leave = joinElection(id) // adds id + notifies everyone (incl. this one)
    return () => { electionSubs.delete(recompute); leave() }
  }, [])

  const orders = useActiveOrders(tenantId)
  const calls = useOpenWaiterCalls(tenantId)

  const queue = useMemo(() => {
    const ms = (x) => x.createdAt?.toMillis?.() || 0
    // cashier-composed orders are self-accepted an instant later — never modal-worthy
    const oq = (orders || [])
      .filter((o) => o.status === 'pending' && o.source !== 'cashier' && !o.acceptedByUid)
      .map((o) => ({ kind: 'order', id: o.id, at: ms(o), o }))
    const cq = (calls || [])
      .filter((c) => c.status === 'open')
      .map((c) => ({ kind: 'call', id: c.id, at: ms(c), c }))
    return [...oq, ...cq].sort((a, b) => a.at - b.at)
  }, [orders, calls])

  const [idx, setIdx] = useState(0)
  const [minimized, setMinimized] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [, forceTick] = useState(0)
  const muteUntil = useRef(0)
  const [muted, setMuted] = useState(false)

  // POS busy → arrivals collapse to the pill instead of covering the cart.
  // When the POS CLOSES, un-minimize: `minimized` also gates the 45s re-chime,
  // so leaving it set after the cart was done meant one POS visit permanently
  // silenced the escalation for every alert still in (or later joining) the
  // queue — the exact "order sat on the floor with no sound" failure this
  // component exists to prevent.
  const [posBusy, setPosBusyState] = useState(isPosBusy())
  useEffect(() => onPosBusy(setPosBusyState), [])
  useEffect(() => { setMinimized(posBusy) }, [posBusy])

  const empty = queue.length === 0
  useEffect(() => {
    if (empty) { setMinimized(false); setIdx(0); setClaiming(false) }
  }, [empty])
  // keep the carousel index in range when coworkers claim items out from under
  // it — otherwise Prev appears dead for several clicks (idx stranded past the
  // shrunken end while the displayed card clamps to the last one).
  useEffect(() => {
    setIdx((i) => Math.min(i, Math.max(0, queue.length - 1)))
  }, [queue.length])
  // a fresh queue that starts while the POS is busy starts minimized
  const hadQueue = useRef(false)
  useEffect(() => {
    if (!empty && !hadQueue.current && isPosBusy()) setMinimized(true)
    hadQueue.current = !empty
  }, [empty])

  // ages must move on their own; 30s is enough for "N min"
  useEffect(() => {
    if (empty) return undefined
    const iv = setInterval(() => forceTick((x) => x + 1), 30000)
    return () => clearInterval(iv)
  }, [empty])

  // gentle re-chime while unaccepted work is on the floor (device prefs decide
  // the sound). SILENT while minimized: a cashier who collapsed the alert to
  // stay on their half-built cart must not get pinged every 45s with no mute
  // control on the pill — the minimized state IS the "I'm on it, hush" signal.
  useEffect(() => {
    if (empty || !primary || minimized) return undefined
    const iv = setInterval(() => {
      if (Date.now() < muteUntil.current) return
      const p = getPrefs()
      if (p?.enabled) playFromPrefs(p)
    }, RECHIME_MS)
    return () => clearInterval(iv)
  }, [empty, primary, minimized])

  if (!primary) return null
  if (!tenantId) return null
  if (!(isManager || can(CAP.TAKE_ORDERS))) return null
  if (empty) return null

  const cur = queue[Math.min(idx, queue.length - 1)]
  // SAME precedence as Cashier/Kds (profile first): on PIN-only REAL sessions
  // profile.displayName IS the staffer; the local PIN marker is the legacy
  // shared-account fallback. The old reversed order stamped acceptedByName and
  // servedByName with two different identities for one order.
  const actorName = profile?.displayName || getPinActor(tenantId)?.name || profile?.email || (ar ? 'موظف' : 'staff')

  const doClaim = async () => {
    if (!cur || claiming) return
    setClaiming(true)
    const me = { name: actorName, uid: user?.uid || '' }
    const res = cur.kind === 'order'
      ? await claimOrder(tenantId, cur.id, me)
      : await claimWaiterCall(tenantId, cur.id, me)
    setClaiming(false)
    if (res.ok) {
      toast.success(cur.kind === 'order' ? (ar ? 'الطلب لك، ابدأ التحضير' : 'Order accepted') : (ar ? 'النداء لك، الطاولة بانتظارك' : 'Call claimed'))
    } else if (res.by) {
      toast.toast(ar ? `سبقك ${res.by} إليها` : `${res.by} got it first`)
    } else if (!res.gone) {
      toast.error(ar ? 'ما تمّ القبول. اضغط «قبول» مرة ثانية' : 'The claim did not go through. Tap Accept again')
    }
  }
  const openDetails = () => {
    setMinimized(true)
    navigate(cur.kind === 'order' ? `/cashier?order=${cur.id}` : '/cashier')
  }
  const doMute = () => {
    muteUntil.current = Date.now() + MUTE_MS
    setMuted(true)
    setTimeout(() => setMuted(false), MUTE_MS)
  }

  const oldest = queue[0]
  const oldestMin = minutesSince(oldest.at ? new Date(oldest.at) : new Date())

  const pill = (
    <button type="button" className="ia-pill" onClick={() => setMinimized(false)}>
      <span className="ia-pill-dot" aria-hidden />
      <Icon name="bellRing" size={15} />
      <span className="ia-pill-count num">{queue.length}</span>
      <span className="ia-pill-text">{ar ? 'بانتظار القبول' : 'awaiting accept'}</span>
      {oldestMin > 0 && <span className="ia-pill-age num">{oldestMin}{ar ? ' د' : 'm'}</span>}
    </button>
  )

  const orderCard = (o) => {
    const items = o.items || []
    const shown = items.slice(0, 4)
    return (
      <>
        <div className="ia-head-row">
          <span className="ia-kind"><Icon name="orders" size={16} /> {ar ? 'طلب جديد' : 'New order'}</span>
          <strong className="ia-code num">{orderNumber(o.code)}</strong>
        </div>
        <div className="ia-chips">
          <span className="ia-chip">
            <Icon name={(o.orderType === 'curbside' || o.orderType === 'delivery') ? 'car' : o.orderType === 'pickup' ? 'bag' : 'tables'} size={14} />
            {o.tableLabel || (o.orderType === 'curbside' ? (ar ? 'سيارة' : 'Curbside') : o.orderType === 'delivery' ? (ar ? 'توصيل' : 'Delivery') : o.orderType === 'pickup' ? (ar ? 'استلام' : 'Pickup') : (ar ? 'سفري' : 'Takeaway'))}
          </span>
          {o.customerName && <span className="ia-chip"><Icon name="user" size={13} /> {o.customerName}</span>}
          <span className="ia-chip ia-chip-age"><Icon name="clock" size={13} /> {timeAgo(o.createdAt, lang)}</span>
        </div>
        <div className="ia-items">
          {shown.map((l, i) => (
            <div key={i} className="ia-item">
              <span className="ia-item-qty num">{l.qty}×</span>
              <span className="ia-item-name">{ar || !l.nameEn ? l.nameAr : l.nameEn}{l.variantLabel ? ` · ${l.variantLabel}` : ''}</span>
            </div>
          ))}
          {items.length > shown.length && (
            <div className="ia-item ia-item-more num">+{items.length - shown.length} {ar ? 'أصناف أخرى' : 'more'}</div>
          )}
        </div>
        {o.notes && <div className="ia-note">{o.notes}</div>}
        <div className="ia-total">
          <span>{ar ? 'الإجمالي' : 'Total'}</span>
          <strong className="num"><Price value={o.total} currency={currency} lang={lang} /></strong>
        </div>
      </>
    )
  }

  const callCard = (c) => (
    <>
      <div className="ia-head-row">
        <span className="ia-kind ia-kind-call"><Icon name="bellRing" size={16} /> {ar ? 'مناداة نادل' : 'Waiter call'}</span>
      </div>
      <div className="ia-chips">
        <span className="ia-chip"><Icon name="tables" size={14} /> {c.tableLabel || (ar ? 'طاولة' : 'Table')}</span>
        {c.orderCode && <span className="ia-chip num"><Icon name="orders" size={13} /> {orderNumber(c.orderCode)}</span>}
        <span className="ia-chip ia-chip-age"><Icon name="clock" size={13} /> {timeAgo(c.createdAt, lang)}</span>
        {c.repeats > 0 && <span className="ia-chip ia-chip-warn num">{ar ? 'كرّرها' : 'repeated'} {c.repeats}</span>}
      </div>
      <div className="ia-call-text">{callText(c, lang)}</div>
    </>
  )

  return createPortal(
    minimized ? pill : (
      <div className="ia-backdrop" role="dialog" aria-modal="true" aria-label={ar ? 'طلبات بانتظار القبول' : 'Awaiting acceptance'}>
        <div className="ia-card">
          <div className="ia-topbar">
            {queue.length > 1 ? (
              <div className="ia-nav">
                <button type="button" className="ia-nav-btn" disabled={idx <= 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}><Icon name="next" size={16} /></button>
                <span className="ia-counter num">{Math.min(idx, queue.length - 1) + 1} / {queue.length}</span>
                <button type="button" className="ia-nav-btn" disabled={idx >= queue.length - 1} onClick={() => setIdx((i) => Math.min(queue.length - 1, i + 1))}><Icon name="back" size={16} /></button>
              </div>
            ) : <span />}
            <div className="ia-top-actions">
              <button type="button" className="ia-icon-btn" onClick={doMute} title={ar ? 'كتم الصوت 5 دقائق' : 'Mute 5 min'}>
                <Icon name={muted ? 'bellOff' : 'bell'} size={16} />
              </button>
              <button type="button" className="ia-icon-btn" onClick={() => setMinimized(true)} title={ar ? 'تصغير' : 'Minimize'}>
                <Icon name="minus" size={16} />
              </button>
            </div>
          </div>
          {cur.kind === 'order' ? orderCard(cur.o) : callCard(cur.c)}
          <div className="ia-actions">
            <button type="button" className="ia-accept" disabled={claiming} onClick={doClaim}>
              {claiming
                ? <span className="ia-spin" aria-hidden />
                : <Icon name="check" size={18} />}
              {cur.kind === 'order' ? (ar ? 'قبول الطلب' : 'Accept order') : (ar ? 'أنا قادم' : 'On my way')}
            </button>
            {cur.kind === 'order' && (
              <button type="button" className="ia-secondary" onClick={openDetails}>
                <Icon name="eye" size={15} /> {ar ? 'التفاصيل' : 'Details'}
              </button>
            )}
          </div>
        </div>
      </div>
    ),
    document.body,
  )
}
