import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePublicVenue } from '../../lib/usePublicVenue.js'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { FullSpinner, Empty, Stepper } from '../../components/ui.jsx'
import DinerBar from '../../components/DinerBar.jsx'
import MenuView from '../../components/MenuView.jsx'
import Sheet from '../../components/Sheet.jsx'
import { resolveTableByToken, callWaiter } from '../../lib/db.js'
import Icon from '../../components/Icon.jsx'

export default function TableMenu() {
  const { slug, token } = useParams()
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const toast = useToast()
  const venue = usePublicVenue(slug)

  const [table, setTable] = useState(undefined) // undefined=loading, null=not found
  const [partySize, setPartySize] = useState(2)
  const [gateOpen, setGateOpen] = useState(true)
  const [calling, setCalling] = useState(false)

  useEffect(() => {
    if (!venue.tenantId) return
    const cacheKey = `table_${venue.tenantId}_${token}`
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      try {
        setTable(JSON.parse(cached))
      } catch (_) {}
    }
    resolveTableByToken(venue.tenantId, token).then((t) => {
      setTable(t)
      if (t) {
        localStorage.setItem(cacheKey, JSON.stringify(t))
      }
    })
  }, [venue.tenantId, token])

  const isMenuLoading = venue.loading && !venue.items?.length
  const isTableLoading = table === undefined

  if (isMenuLoading || isTableLoading) {
    if (venue.tenant) {
      return (
        <div style={{ minHeight: '100dvh' }}>
          <DinerBar
            tenant={venue.tenant}
            right={table ? <span className="badge" style={{ marginInlineEnd: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="tables" size={13} /> {table.label}</span> : null}
          />
          <div style={{ display: 'grid', placeItems: 'center', minHeight: 'calc(100dvh - 100px)' }}>
            <span className="spinner" style={{ color: 'var(--brand)' }}></span>
          </div>
        </div>
      )
    }
    return <FullSpinner />
  }
  if (venue.notFound) return <div className="auth-shell"><Empty icon="search" title={lang === 'ar' ? 'المنشأة غير موجودة' : 'Venue not found'} /></div>
  if (table === null) return <div className="auth-shell"><Empty icon="tables" title={lang === 'ar' ? 'الطاولة غير معروفة' : 'Unknown table'} hint={lang === 'ar' ? 'امسح رمز الطاولة مرة أخرى' : 'Scan the table QR again'} /></div>

  const doCall = async () => {
    setCalling(true)
    try {
      await callWaiter(venue.tenantId, { tableId: table.id, tableLabel: table.label, reason: 'call' })
      toast.success(t('waiterCalled'))
    } catch (_) {
      toast.error(t('error'))
    } finally {
      setCalling(false)
    }
  }

  return (
    <div style={{ minHeight: '100dvh' }}>
      <DinerBar
        tenant={venue.tenant}
        right={<span className="badge" style={{ marginInlineEnd: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="tables" size={13} /> {table.label}</span>}
      />

      <MenuView
        tenant={venue.tenant}
        tenantId={venue.tenantId}
        items={venue.items}
        categories={venue.categories}
        offers={venue.offers}
        table={table}
        partySize={partySize}
        onCallWaiter={doCall}
        onPlaced={(orderId) => navigate(`/order/${slug}/${orderId}`)}
      />

      {/* party size gate */}
      <Sheet
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        title={`${venue.tenant?.name || ''} · ${table.label}`}
        footer={<button className="btn btn-primary btn-lg btn-block" onClick={() => setGateOpen(false)}>{lang === 'ar' ? 'تصفّح المنيو' : 'Browse menu'}</button>}
      >
        <div className="stack center" style={{ gap: 'var(--sp-4)', textAlign: 'center' }}>
          <span style={{ fontSize: 40, color: 'var(--brand)' }}><Icon name="waiter" size={40} /></span>
          <p className="bold" style={{ fontSize: 'var(--fs-md)' }}>{lang === 'ar' ? 'أهلاً بك! كم عدد الأشخاص؟' : 'Welcome! How many guests?'}</p>
          <Stepper value={partySize} onChange={setPartySize} min={1} max={20} />
        </div>
      </Sheet>
    </div>
  )
}
