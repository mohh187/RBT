import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import Icon from '../../components/Icon.jsx'
import Sheet from '../../components/Sheet.jsx'
import { Empty, Spinner } from '../../components/ui.jsx'
import { Price } from '../../components/Riyal.jsx'
import { watchDriverDeliveries, watchDeliveryPool, assignDelivery, setDeliveryStatus, updateDriverLocation, collectCod } from '../../lib/db.js'

const D_STATUS = {
  pending: { ar: 'بانتظار مندوب', en: 'Waiting', cls: '' },
  assigned: { ar: 'مُسند إليك', en: 'Assigned', cls: 'badge-info' },
  picked_up: { ar: 'استُلم', en: 'Picked up', cls: 'badge-info' },
  on_way: { ar: 'في الطريق', en: 'On the way', cls: 'badge-info' },
  delivered: { ar: 'تم التسليم', en: 'Delivered', cls: 'badge-success' },
  failed: { ar: 'تعذّر', en: 'Failed', cls: 'badge-danger' },
}
const NEXT = {
  assigned: { to: 'picked_up', ar: 'استلمت الطلب', en: 'Picked up' },
  picked_up: { to: 'on_way', ar: 'انطلقت للعميل', en: 'On the way' },
  on_way: { to: 'delivered', ar: 'تم التسليم', en: 'Delivered' },
}

function mapsUrl(d) {
  if (d?.lat && d?.lng) return `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}`
  if (d?.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}`
  return null
}

export default function DriverPortal() {
  const { tenantId, user } = useAuth()
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const toast = useToast()
  const [mine, setMine] = useState(null)
  const [pool, setPool] = useState([])

  useEffect(() => { if (tenantId && user?.uid) return watchDriverDeliveries(tenantId, user.uid, setMine) }, [tenantId, user?.uid])
  useEffect(() => { if (tenantId) return watchDeliveryPool(tenantId, setPool) }, [tenantId])

  // Broadcast the driver's live location while carrying an active delivery
  // (throttled to ~1 write / 15s) so the customer can track the approach.
  const activeId = (mine || []).find((o) => ['picked_up', 'on_way'].includes(o.delivery?.status))?.id
  const lastWrite = useRef(0)
  useEffect(() => {
    if (!activeId || !tenantId || typeof navigator === 'undefined' || !navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const now = Date.now()
        if (now - lastWrite.current < 15000) return
        lastWrite.current = now
        updateDriverLocation(tenantId, activeId, { lat: p.coords.latitude, lng: p.coords.longitude }).catch(() => {})
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [tenantId, activeId])

  const claim = async (o) => {
    try { await assignDelivery(tenantId, o.id, { uid: user.uid, name: user?.displayName || '' }); toast.success(ar ? 'استلمت الطلب' : 'Claimed') }
    catch { toast.error(ar ? 'تعذّر الاستلام' : 'Could not claim') }
  }
  const advance = async (o, to) => { try { await setDeliveryStatus(tenantId, o.id, to) } catch { toast.error(ar ? 'تعذّر التحديث' : 'Update failed') } }
  const release = async (o) => { try { await assignDelivery(tenantId, o.id, null) } catch { toast.error(ar ? 'تعذّر' : 'Failed') } }
  // Mark delivered — for an unpaid order, offer to record the cash collected (COD)
  // via a themed sheet (not window.confirm). An order already settled online
  // (paidOnline / paymentStatus) is NOT COD — never prompt to collect cash again.
  const [codFor, setCodFor] = useState(null)
  const [codBusy, setCodBusy] = useState(false)
  const deliver = async (o) => {
    const unpaid = !o.paidOnline && o.paymentStatus !== 'paid' && !['paid', 'refunded'].includes(o.status)
    if (unpaid) { setCodFor(o); return }
    try { await setDeliveryStatus(tenantId, o.id, 'delivered') }
    catch { toast.error(ar ? 'تعذّر التحديث' : 'Update failed') }
  }
  const finishCod = async (collected) => {
    const o = codFor
    if (!o) return
    setCodBusy(true)
    try {
      if (collected) await collectCod(tenantId, o.id, o.total)
      else await setDeliveryStatus(tenantId, o.id, 'delivered')
      setCodFor(null)
    } catch { toast.error(ar ? 'تعذّر التحديث' : 'Update failed') }
    finally { setCodBusy(false) }
  }

  const active = (mine || []).filter((o) => !['delivered', 'failed'].includes(o.delivery?.status))
  const done = (mine || []).filter((o) => o.delivery?.status === 'delivered')
  const custody = (mine || []).filter((o) => o.delivery?.codCollected && !o.delivery?.codSettled).reduce((s, o) => s + (o.delivery?.codAmount || 0), 0)

  const Card = ({ o, claimable }) => {
    const d = o.delivery || {}
    const st = D_STATUS[d.status] || D_STATUS.pending
    const nx = NEXT[d.status]
    const url = mapsUrl(d)
    return (
      <div className="card card-pad stack" style={{ gap: 8 }}>
        <div className="row-between">
          <strong>#{o.code || o.id.slice(0, 5)}</strong>
          <span className={`badge ${st.cls}`}>{ar ? st.ar : st.en}</span>
        </div>
        {d.address && <div className="small row" style={{ gap: 6, alignItems: 'flex-start' }}><Icon name="pin" size={14} style={{ marginTop: 2, flex: 'none' }} /> <span>{d.address}</span></div>}
        <div className="row-between small">
          <span>{o.customerName || (ar ? 'عميل' : 'Customer')}{d.fee ? ` · ${ar ? 'رسوم' : 'fee'} ` : ''}{d.fee ? <Price value={d.fee} lang={lang} symbolSize="0.8em" /> : null}</span>
          <span className="num bold"><Price value={o.total || 0} lang={lang} symbolSize="0.85em" /></span>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {url && <a className="btn btn-sm btn-outline" href={url} target="_blank" rel="noreferrer"><Icon name="pin" size={14} /> {ar ? 'تنقّل' : 'Navigate'}</a>}
          {o.customerPhone && <a className="btn btn-sm btn-outline" href={`tel:${o.customerPhone}`}><Icon name="phone" size={14} /> {ar ? 'اتصال' : 'Call'}</a>}
          {claimable
            ? <button className="btn btn-sm btn-primary" onClick={() => claim(o)}><Icon name="bag" size={14} /> {ar ? 'استلام الطلب' : 'Claim'}</button>
            : nx && <button className="btn btn-primary" style={{ minHeight: 48, fontWeight: 800 }} onClick={() => (nx.to === 'delivered' ? deliver(o) : advance(o, nx.to))}><Icon name="check" size={16} /> {ar ? nx.ar : nx.en}</button>}
          {!claimable && d.status === 'on_way' && <button className="btn btn-ghost" style={{ color: 'var(--danger)', minHeight: 48 }} onClick={() => advance(o, 'failed')}>{ar ? 'تعذّر التسليم' : 'Failed'}</button>}
          {!claimable && d.status === 'assigned' && <button className="btn btn-sm btn-ghost" onClick={() => release(o)}>{ar ? 'تراجع' : 'Release'}</button>}
        </div>
      </div>
    )
  }

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)', maxWidth: 640, marginInline: 'auto', padding: 'var(--sp-4)' }}>
      <div className="row-between">
        <h2 className="page-title" style={{ margin: 0 }}><Icon name="car" size={20} /> {ar ? 'مهام التوصيل' : 'My deliveries'}</h2>
        <span className="badge">{active.length} {ar ? 'نشطة' : 'active'}</span>
      </div>
      {custody > 0 && (
        <div className="badge badge-info" style={{ alignSelf: 'flex-start', gap: 5 }}>
          <Icon name="wallet" size={13} /> {ar ? 'عهدتك النقدية' : 'Cash on hand'}: <Price value={custody} lang={lang} symbolSize="0.85em" />
        </div>
      )}

      {mine === null ? <Spinner /> : (
        <>
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            {active.length === 0
              ? <Empty icon="car" title={ar ? 'لا مهام نشطة' : 'No active deliveries'} hint={ar ? 'استلم طلباً من المتاح أدناه' : 'Claim one from the list below'} />
              : active.map((o) => <Card key={o.id} o={o} />)}
          </div>

          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            <strong className="small faint">{ar ? 'طلبات متاحة للاستلام' : 'Available to claim'} ({pool.length})</strong>
            {pool.length === 0
              ? <p className="muted small">{ar ? 'لا طلبات متاحة حالياً' : 'None available right now'}</p>
              : pool.map((o) => <Card key={o.id} o={o} claimable />)}
          </div>

          {done.length > 0 && (
            <div className="stack" style={{ gap: 'var(--sp-2)' }}>
              <strong className="small faint">{ar ? 'سُلّمت' : 'Delivered'} ({done.length})</strong>
              {done.map((o) => <Card key={o.id} o={o} />)}
            </div>
          )}
        </>
      )}

      {/* COD confirmation — themed sheet instead of window.confirm */}
      <Sheet open={!!codFor} onClose={() => { if (!codBusy) setCodFor(null) }} title={ar ? 'تحصيل نقدي' : 'Cash collection'}>
        {codFor && (
          <div className="stack" style={{ gap: 'var(--sp-3)', textAlign: 'center', alignItems: 'center' }}>
            <span className="center" style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)' }}><Icon name="wallet" size={26} /></span>
            <div className="small muted">{ar ? 'هل حصّلت المبلغ نقداً من العميل؟' : 'Did you collect the cash from the customer?'}</div>
            <strong className="num" style={{ fontSize: 'var(--fs-2xl)' }}><Price value={codFor.total || 0} lang={lang} /></strong>
            <button className="btn btn-success btn-lg btn-block" disabled={codBusy} onClick={() => finishCod(true)}><Icon name="check" size={18} /> {ar ? 'حصّلت نقداً' : 'Collected cash'}</button>
            <button className="btn btn-outline btn-block" disabled={codBusy} onClick={() => finishCod(false)}>{ar ? 'لم أحصّل — تسليم فقط' : 'Not collected — just delivered'}</button>
          </div>
        )}
      </Sheet>
    </div>
  )
}
