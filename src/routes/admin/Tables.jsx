import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import Sheet from '../../components/Sheet.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import FloorMap, { TableShape } from '../../components/FloorMap.jsx'
import CashierPOS from '../../components/CashierPOS.jsx'
import OrderDetail from '../../components/OrderDetail.jsx'
import { watchTables, createTable, saveTable, deleteTable, watchOrdersSince, watchReservations, createReservation, setReservationStatus } from '../../lib/db.js'
import { tableUrl, qrDataUrl, printQrCard, printAllTableQrs, publicBaseUrl } from '../../lib/qr.js'
import { alertParty } from '../../lib/notify.js'
import { money } from '../../lib/format.js'

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

export default function Tables() {
  const { t, lang } = useI18n()
  const { tenantId, tenant, profile } = useAuth()
  const ar = lang === 'ar'
  const actorName = profile?.displayName || profile?.email || ''
  const toast = useToast()
  const [tables, setTables] = useState(null)
  const [orders, setOrders] = useState([])
  const [reservations, setReservations] = useState([])
  const [edit, setEdit] = useState(false)
  const [localPos, setLocalPos] = useState({})
  const [addOpen, setAddOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [seats, setSeats] = useState(4)
  const [shape, setShape] = useState('round')
  const [zoneNew, setZoneNew] = useState('')
  const [zone, setZone] = useState('all') // active zone tab
  const [sel, setSel] = useState(null) // tapped table (action sheet)
  const [posTable, setPosTable] = useState(null) // open POS for this table
  const [detailId, setDetailId] = useState(null)
  const [qrFor, setQrFor] = useState(null)
  const [resFor, setResFor] = useState(null) // quick reserve form for a table
  const prevRes = useRef(0)
  const seeded = useRef(false)

  // Edit table states
  const [editLabel, setEditLabel] = useState('')
  const [editSeats, setEditSeats] = useState(4)
  const [editShape, setEditShape] = useState('round')
  const [editZone, setEditZone] = useState('')

  useEffect(() => {
    if (sel) {
      setEditLabel(sel.label || '')
      setEditSeats(sel.seats || 4)
      setEditShape(sel.shape || 'round')
      setEditZone(sel.zone || '')
    }
  }, [sel])

  // minute tick so occupied-time chips stay fresh while the page is open
  const [, setTick] = useState(0)
  useEffect(() => { const iv = setInterval(() => setTick((n) => n + 1), 30000); return () => clearInterval(iv) }, [])

  useEffect(() => {
    if (!tenantId) return
    const u1 = watchTables(tenantId, setTables)
    const u2 = watchOrdersSince(tenantId, startOfToday(), setOrders)
    const u3 = watchReservations(tenantId, setReservations)
    return () => { u1(); u2(); u3() }
  }, [tenantId])

  const tableBookings = useMemo(() => reservations.filter((r) => r.kind === 'table' && !['cancelled', 'done', 'seated'].includes(r.status)), [reservations])

  // live alert on a new table booking request
  useEffect(() => {
    const n = tableBookings.filter((r) => r.status === 'requested').length
    if (seeded.current && n > prevRes.current) alertParty({ title: ar ? 'حجز طاولة جديد' : 'New table booking', body: tableBookings[0]?.name || '', tag: 'booking', url: '/admin/operations' })
    prevRes.current = n; seeded.current = true
  }, [tableBookings, ar])

  // a table is occupied while it has a today order that isn't paid/cancelled/refunded (stays until settled).
  // when every active order is already served, the table is 'billed' (awaiting payment — blue).
  const activeByTable = useMemo(() => { const m = {}; orders.forEach((o) => { if (o.tableId && !['paid', 'cancelled', 'refunded'].includes(o.status)) (m[o.tableId] = m[o.tableId] || []).push(o) }); return m }, [orders])
  const orderByTable = useMemo(() => { const m = {}; Object.entries(activeByTable).forEach(([k, list]) => { m[k] = list[0] }); return m }, [activeByTable])
  const reservedIds = useMemo(() => { const s = new Set(); tableBookings.forEach((r) => { if (r.tableId && (!r.date || r.date === todayStr())) s.add(r.tableId) }); return s }, [tableBookings])
  const statusOf = (tb) => { const list = activeByTable[tb.id]; if (list?.length) return list.every((o) => o.status === 'served') ? 'billed' : 'occupied'; return reservedIds.has(tb.id) ? 'reserved' : 'free' }

  // elapsed-time + running-bill chip shown under occupied/billed tables
  const toDate = (ts) => (ts?.toDate ? ts.toDate() : ts?.seconds ? new Date(ts.seconds * 1000) : null)
  const metaOf = (tb) => {
    const list = activeByTable[tb.id]
    if (!list?.length) return ''
    const times = list.map((o) => toDate(o.createdAt)).filter(Boolean).map((d) => d.getTime())
    const m = times.length ? Math.max(0, Math.round((Date.now() - Math.min(...times)) / 60000)) : 0
    const dur = m >= 60 ? `${Math.floor(m / 60)}${ar ? 'س' : 'h'} ${m % 60}${ar ? 'د' : 'm'}` : `${m}${ar ? 'د' : 'm'}`
    const total = list.reduce((s, o) => s + (o.total || 0), 0)
    return `${dur} · ${money(total, tenant?.currency || 'SAR', lang)}`
  }

  const merged = useMemo(() => {
    return (tables || []).map((tb) => {
      const pos = localPos[tb.id] || {}
      return { ...tb, ...pos, activeOrdersCount: (activeByTable[tb.id] || []).length }
    })
  }, [tables, localPos, activeByTable])

  // zones (optional per table) → filter tabs above the floor
  const zones = useMemo(() => { const s = new Set(); (tables || []).forEach((tb) => { const z = (tb.zone || '').trim(); if (z) s.add(z) }); return [...s] }, [tables])
  const hasUnzoned = useMemo(() => (tables || []).some((tb) => !(tb.zone || '').trim()), [tables])
  useEffect(() => { if (zone !== 'all' && zone !== '@none' && !zones.includes(zone)) setZone('all') }, [zones, zone])
  const shown = useMemo(() => (zone === 'all' ? merged : merged.filter((tb) => (zone === '@none' ? !(tb.zone || '').trim() : (tb.zone || '').trim() === zone))), [merged, zone])

  const counts = useMemo(() => { let free = 0; let occ = 0; let billed = 0; let res = 0; (tables || []).forEach((tb) => { const s = statusOf(tb); if (s === 'occupied') occ++; else if (s === 'billed') billed++; else if (s === 'reserved') res++; else free++ }); return { free, occ, billed, res } }, [tables, activeByTable, reservedIds]) // eslint-disable-line

  const onMove = (id, x, y, save) => {
    if (save) { const p = localPos[id]; if (p) { const sx = Math.round(p.x / 12) * 12; const sy = Math.round(p.y / 12) * 12; setLocalPos((m) => ({ ...m, [id]: { x: sx, y: sy } })); saveTable(tenantId, id, { x: sx, y: sy }) } }
    else setLocalPos((m) => ({ ...m, [id]: { x, y } }))
  }

  const add = async () => {
    const name = label.trim() || `${ar ? 'طاولة' : 'Table'} ${(tables?.length || 0) + 1}`
    await createTable(tenantId, { label: name, seats: Number(seats) || 4, shape, zone: zoneNew.trim() })
    setLabel(''); setSeats(4); setShape('round'); setZoneNew(''); setAddOpen(false); toast.success(t('saved'))
  }
  const remove = async (id) => { if (window.confirm(t('areYouSure'))) { await deleteTable(tenantId, id); setSel(null) } }

  if (tables === null) return <Spinner />

  const selOrder = sel ? orderByTable[sel.id] : null

  return (
    <div className="page stack">
      <div className="row-between">
        <h2 className="page-title row" style={{ gap: 8 }}><Icon name="tables" size={22} /> {t('tables')}</h2>
        <div className="row" style={{ gap: 6 }}>
          <button className={`btn btn-sm ${edit ? 'btn-primary' : 'btn-outline'}`} onClick={() => setEdit((e) => !e)}><Icon name="drag" size={15} /> {ar ? 'ترتيب' : 'Arrange'}</button>
          <button className="btn btn-sm btn-primary" onClick={() => setAddOpen(true)}><Icon name="add" size={15} /> {t('addTable')}</button>
        </div>
      </div>

      {/* status legend + counts */}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="badge" style={{ borderColor: '#16a34a', color: '#16a34a', background: 'transparent' }}>● {ar ? 'متاحة' : 'Free'} {counts.free}</span>
        <span className="badge" style={{ borderColor: '#dc2626', color: '#dc2626', background: 'transparent' }}>● {ar ? 'مشغولة' : 'Occupied'} {counts.occ}</span>
        <span className="badge" style={{ borderColor: '#2563eb', color: '#2563eb', background: 'transparent' }}>● {ar ? 'مفوترة' : 'Billed'} {counts.billed}</span>
        <span className="badge" style={{ borderColor: '#e0a82e', color: '#e0a82e', background: 'transparent' }}>● {ar ? 'محجوزة' : 'Reserved'} {counts.res}</span>
      </div>

      {/* zone tabs (only when zones exist) */}
      {zones.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${zone === 'all' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setZone('all')}>{ar ? 'كل المناطق' : 'All zones'}</button>
          {zones.map((z) => (
            <button key={z} className={`btn btn-sm ${zone === z ? 'btn-primary' : 'btn-outline'}`} onClick={() => setZone(z)}>{z}</button>
          ))}
          {hasUnzoned && <button className={`btn btn-sm ${zone === '@none' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setZone('@none')}>{ar ? 'بدون منطقة' : 'No zone'}</button>}
        </div>
      )}

      {/* existing zone names for the add/edit inputs */}
      <datalist id="floor-zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>

      {tables.length === 0 ? (
        <Empty icon="tables" title={ar ? 'لا توجد طاولات' : 'No tables'} hint={ar ? 'أضِف طاولات واسحبها لترتيب المخطط' : 'Add tables and drag to arrange the floor'} />
      ) : (
        <>
          {edit && <p className="xs faint">{ar ? 'اسحب الطاولات لترتيب المخطط، ثم أوقف «ترتيب».' : 'Drag tables to arrange, then turn off Arrange.'}</p>}
          <FloorMap tables={shown} statusOf={statusOf} metaOf={metaOf} edit={edit} onMove={onMove} onTap={setSel} />
        </>
      )}

      {/* today's bookings */}
      {tableBookings.length > 0 && (
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <strong className="small row" style={{ gap: 6 }}><Icon name="reservations" size={16} /> {ar ? 'حجوزات الطاولات' : 'Table bookings'}</strong>
          {tableBookings.map((r) => (
            <div key={r.id} className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div className="grow">
                <div className="small bold">{r.name || (ar ? 'ضيف' : 'Guest')} · {r.partySize || 1} {ar ? 'أشخاص' : 'ppl'} {r.status === 'requested' && <span className="badge badge-gold">{ar ? 'بانتظار' : 'Requested'}</span>}{r.status === 'confirmed' && <span className="badge badge-success">{ar ? 'مؤكّد' : 'Confirmed'}</span>}</div>
                <div className="xs faint">{r.tableLabel || (ar ? 'أي طاولة' : 'Any table')}{r.time ? ` · ${r.time}` : ''}{r.date ? ` · ${r.date}` : ''}{r.phone ? ` · ${r.phone}` : ''}</div>
              </div>
              <div className="row" style={{ gap: 4 }}>
                {r.status === 'requested' && <button className="btn btn-sm btn-success" onClick={() => setReservationStatus(tenantId, r.id, 'confirmed')}>{ar ? 'تأكيد' : 'Confirm'}</button>}
                <button className="btn btn-sm btn-outline" onClick={() => setReservationStatus(tenantId, r.id, 'seated')}>{ar ? 'حضر' : 'Seated'}</button>
                <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => setReservationStatus(tenantId, r.id, 'cancelled')}><Icon name="close" size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tables.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-outline grow" onClick={() => printAllTableQrs(tables, tenant?.slug, { venueName: tenant?.name, lang })}><Icon name="print" size={16} /> {ar ? 'طباعة رموز الطاولات' : 'Print QR codes'}</button>
          {tenant?.slug && <button className="btn btn-outline grow" onClick={() => { navigator.clipboard?.writeText(`${publicBaseUrl()}/reserve/${tenant.slug}`); toast.success(ar ? 'تم نسخ رابط الحجز' : 'Booking link copied') }}><Icon name="reservations" size={16} /> {ar ? 'رابط الحجز المسبق' : 'Booking link'}</button>}
        </div>
      )}

      {/* table action sheet */}
      <Sheet open={!!sel} onClose={() => setSel(null)} title={`${ar ? 'إدارة طاولة' : 'Manage'}: ${sel ? sel.label : ''}`}>
        {sel && (() => {
          const activeOrdersForSel = orders.filter(o => o.tableId === sel.id && !['paid', 'cancelled', 'refunded'].includes(o.status))
          const pastOrdersForSel = orders.filter(o => o.tableId === sel.id && ['paid'].includes(o.status))
          return (
            <div className="stack" style={{ gap: 'var(--sp-3)' }}>
              
              {/* Preview & Status */}
              <div className="stack center" style={{ gap: 6 }}>
                <TableShape seats={editSeats} shape={editShape} status={statusOf(sel)} label={editLabel || sel.label} size={70} activeOrdersCount={activeOrdersForSel.length} meta={metaOf(sel)} />
                <span className="small faint">{editSeats} {t('seats')} · {statusOf(sel) === 'occupied' ? (ar ? 'مشغولة' : 'Occupied') : statusOf(sel) === 'billed' ? (ar ? 'مفوترة — بانتظار الدفع' : 'Billed — awaiting payment') : statusOf(sel) === 'reserved' ? (ar ? 'محجوزة' : 'Reserved') : (ar ? 'متاحة' : 'Free')}</span>
              </div>

              {/* SECTION 1: Active Orders list for direct navigation */}
              {activeOrdersForSel.length > 0 && (
                <div className="stack" style={{ gap: 6, background: 'color-mix(in srgb, var(--brand) 6%, var(--surface))', padding: '10px 12px', borderRadius: 12, border: '1px solid var(--border)' }}>
                  <strong className="xs row" style={{ gap: 4, color: 'var(--brand)' }}><Icon name="orders" size={13} /> {ar ? 'الطلبات النشطة على الطاولة:' : 'Active orders:'}</strong>
                  <div className="stack" style={{ gap: 6 }}>
                    {activeOrdersForSel.map((ord) => (
                      <button key={ord.id} className="row-between btn btn-sm btn-outline btn-block" style={{ background: 'var(--surface)' }} onClick={() => { setDetailId(ord.id); setSel(null) }}>
                        <span className="small bold">#{ord.code} · {ord.itemsCount || ord.items?.length || 0} {ar ? 'أصناف' : 'items'}</span>
                        <span className="badge badge-gold" style={{ fontSize: 9, textTransform: 'capitalize' }}>{t(`status_${ord.status}`) || ord.status}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* SECTION 2: Paid/Past Orders today */}
              {pastOrdersForSel.length > 0 && (
                <div className="stack" style={{ gap: 6, background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 12, border: '1px dashed var(--border)' }}>
                  <strong className="xs row" style={{ gap: 4, color: 'var(--text-faint)' }}><Icon name="check" size={13} /> {ar ? 'الطلبات المدفوعة اليوم:' : 'Paid orders today:'}</strong>
                  <div className="stack" style={{ gap: 4 }}>
                    {pastOrdersForSel.map((ord) => (
                      <button key={ord.id} className="row-between btn btn-sm btn-outline btn-block" style={{ background: 'var(--surface)', opacity: 0.85 }} onClick={() => { setDetailId(ord.id); setSel(null) }}>
                        <span className="small">#{ord.code} · {ord.itemsCount || ord.items?.length || 0} {ar ? 'أصناف' : 'items'}</span>
                        <span className="badge badge-success" style={{ fontSize: 9 }}>{ar ? 'مدفوع' : 'Paid'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Actions */}
              <div className="row" style={{ gap: 6 }}>
                {selOrder ? (
                  <>
                    {statusOf(sel) === 'billed' ? (
                      <button className="btn btn-primary grow" onClick={() => { setDetailId(selOrder.id); setSel(null) }}><Icon name="wallet" size={15} /> {ar ? 'تحصيل الدفع' : 'Collect payment'}</button>
                    ) : (
                      <button className="btn btn-primary grow" onClick={() => { setDetailId(selOrder.id); setSel(null) }}><Icon name="eye" size={15} /> {ar ? 'الطلب الحالي' : 'Current order'}</button>
                    )}
                    <button className="btn btn-outline grow" onClick={() => { setPosTable(sel); setSel(null) }}><Icon name="add" size={15} /> {ar ? 'إضافة صنف' : 'Add item'}</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-primary grow" onClick={() => { setPosTable(sel); setSel(null) }}><Icon name="add" size={15} /> {ar ? 'طلب جديد' : 'New order'}</button>
                    <button className="btn btn-outline grow" onClick={() => { setResFor(sel); setSel(null) }}><Icon name="reservations" size={15} /> {ar ? 'حجز' : 'Reserve'}</button>
                  </>
                )}
              </div>

              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-outline grow" onClick={() => { setQrFor(sel); setSel(null) }}><Icon name="qr" size={15} /> {t('qrCode')}</button>
                <button className="btn btn-outline" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => remove(sel.id)}><Icon name="delete" size={15} /></button>
              </div>

              {/* Configuration Tools */}
              <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-2)', marginTop: 4 }}>
                <strong className="xs muted">{ar ? 'تخصيص الطاولة (شكل وكراسي):' : 'Configure Table (Shape & Chairs):'}</strong>
                
                <div className="field">
                  <label>{ar ? 'اسم / رقم الطاولة' : 'Table Label'}</label>
                  <input className="input" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                </div>

                <div className="field">
                  <label>{ar ? 'شكل الطاولة' : 'Table Shape'}</label>
                  <div className="segmented">
                    <button className={editShape === 'round' ? 'active' : ''} onClick={() => setEditShape('round')}>{ar ? 'دائرية' : 'Round'}</button>
                    <button className={editShape === 'square' ? 'active' : ''} onClick={() => setEditShape('square')}>{ar ? 'مربعة' : 'Square'}</button>
                    <button className={editShape === 'rect' ? 'active' : ''} onClick={() => setEditShape('rect')}>{ar ? 'مستطيلة' : 'Rect'}</button>
                  </div>
                </div>

                <div className="field">
                  <label>{ar ? 'المنطقة (صالة / خارجية / تراس…)' : 'Zone (hall / outdoor / terrace…)'}</label>
                  <input className="input" list="floor-zones" value={editZone} onChange={(e) => setEditZone(e.target.value)} placeholder={ar ? 'اتركه فارغاً بلا منطقة' : 'Leave empty for no zone'} />
                </div>

                <div className="field">
                  <label>{ar ? 'عدد الكراسي (المقاعد)' : 'Number of Chairs'}</label>
                  <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                    <button className="btn btn-sm btn-outline" onClick={() => setEditSeats(Math.max(1, editSeats - 1))} style={{ width: 36, height: 36, fontSize: 18, fontWeight: 'bold' }}>-</button>
                    <strong style={{ fontSize: 16, minWidth: 24, textAlign: 'center' }}>{editSeats}</strong>
                    <button className="btn btn-sm btn-outline" onClick={() => setEditSeats(editSeats + 1)} style={{ width: 36, height: 36, fontSize: 18, fontWeight: 'bold' }}>+</button>
                  </div>
                </div>

                <button className="btn btn-success btn-block btn-lg" style={{ marginTop: 8 }} onClick={async () => {
                  await saveTable(tenantId, sel.id, { label: editLabel.trim(), seats: Number(editSeats), shape: editShape, zone: editZone.trim() })
                  setSel(null)
                  toast.success(t('saved'))
                }}><Icon name="check" size={16} /> {ar ? 'حفظ التعديلات' : 'Save Changes'}</button>
              </div>

            </div>
          )
        })()}
      </Sheet>

      {/* create table */}
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title={t('addTable')} footer={<button className="btn btn-primary btn-block" onClick={add}>{t('save')}</button>}>
        <div className="stack">
          <div className="field"><label>{t('tableLabel')}</label><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={ar ? 'طاولة 1' : 'Table 1'} /></div>
          <div className="field"><label>{t('seats')}</label><input className="input num" type="number" min="1" value={seats} onChange={(e) => setSeats(e.target.value)} /></div>
          <div className="field"><label>{ar ? 'الشكل' : 'Shape'}</label>
            <div className="segmented"><button className={shape === 'round' ? 'active' : ''} onClick={() => setShape('round')}>{ar ? 'دائرية' : 'Round'}</button><button className={shape === 'square' ? 'active' : ''} onClick={() => setShape('square')}>{ar ? 'مربّعة' : 'Square'}</button><button className={shape === 'rect' ? 'active' : ''} onClick={() => setShape('rect')}>{ar ? 'مستطيلة' : 'Rect'}</button></div>
          </div>
          <div className="field"><label>{ar ? 'المنطقة (اختياري)' : 'Zone (optional)'}</label><input className="input" list="floor-zones" value={zoneNew} onChange={(e) => setZoneNew(e.target.value)} placeholder={ar ? 'صالة / خارجية / تراس…' : 'Hall / outdoor / terrace…'} /></div>
          <div className="stack center" style={{ paddingTop: 6 }}><TableShape seats={Number(seats) || 4} shape={shape} status="free" label={label || (ar ? 'طاولة' : 'Table')} /></div>
        </div>
      </Sheet>

      {resFor && <ReserveSheet table={resFor} tenantId={tenantId} lang={lang} onClose={() => setResFor(null)} onDone={() => { setResFor(null); toast.success(ar ? 'تم الحجز' : 'Reserved') }} />}
      {posTable && <CashierPOS open onClose={() => setPosTable(null)} tenantId={tenantId} tenant={tenant} lang={lang} actorName={actorName} initialTable={posTable} />}
      {detailId && <OrderDetail tid={tenantId} orderId={detailId} currency={tenant?.currency || 'SAR'} staffActions onClose={() => setDetailId(null)} />}
      {qrFor && <QrSheet table={qrFor} slug={tenant?.slug} onClose={() => setQrFor(null)} />}
    </div>
  )
}

function ReserveSheet({ table, tenantId, lang, onClose, onDone }) {
  const ar = lang === 'ar'
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [party, setParty] = useState(table.seats || 2)
  const [time, setTime] = useState('')
  const save = async () => {
    await createReservation(tenantId, { kind: 'table', tableId: table.id, tableLabel: table.label, name: name.trim(), phone: phone.trim(), partySize: Number(party) || 1, date: todayStr(), time })
    onDone?.()
  }
  return (
    <Sheet open onClose={onClose} title={`${ar ? 'حجز' : 'Reserve'} · ${table.label}`} footer={<button className="btn btn-primary btn-block" onClick={save}>{ar ? 'تأكيد الحجز' : 'Confirm booking'}</button>}>
      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        <div className="field"><label>{ar ? 'الاسم' : 'Name'}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="row" style={{ gap: 8 }}>
          <div className="field grow"><label>{ar ? 'الجوال' : 'Phone'}</label><input className="input num" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="field" style={{ maxWidth: 100 }}><label>{ar ? 'الأشخاص' : 'Party'}</label><input className="input num" type="number" min="1" value={party} onChange={(e) => setParty(e.target.value)} /></div>
        </div>
        <div className="field"><label>{ar ? 'الوقت' : 'Time'}</label><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
      </div>
    </Sheet>
  )
}

function QrSheet({ table, slug, onClose }) {
  const { t, lang } = useI18n()
  const [dataUrl, setDataUrl] = useState('')
  const url = tableUrl(slug, table.qrToken)
  useEffect(() => { let alive = true; qrDataUrl(url, { width: 600 }).then((d) => alive && setDataUrl(d)); return () => { alive = false } }, [url])
  const download = () => { const a = document.createElement('a'); a.href = dataUrl; a.download = `${table.label}-qr.png`; a.click() }
  return (
    <Sheet open onClose={onClose} title={`${t('qrCode')} · ${table.label}`}
      footer={<div className="row" style={{ gap: 'var(--sp-2)' }}><button className="btn btn-outline grow" onClick={download} disabled={!dataUrl}><Icon name="download" size={16} /> {t('downloadQr')}</button><button className="btn btn-primary grow" onClick={() => printQrCard({ dataUrl, title: table.label, subtitle: lang === 'ar' ? 'امسح للطلب' : 'Scan to order', url })} disabled={!dataUrl}><Icon name="print" size={16} /> {t('printQr')}</button></div>}>
      <div className="stack center" style={{ gap: 'var(--sp-3)' }}>
        {dataUrl ? <img src={dataUrl} alt="QR" style={{ width: 240, height: 240 }} /> : <div className="spinner spinner-lg" />}
        <p className="xs faint text-center" dir="ltr" style={{ wordBreak: 'break-all' }}>{url}</p>
      </div>
    </Sheet>
  )
}
