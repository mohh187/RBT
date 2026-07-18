// The full cross-venue activity log — every registration, order, status move,
// complaint, staff change, settings edit, subscription change, chat message
// and error, live, filterable by venue / kind / severity.
import { useEffect, useMemo, useState } from 'react'
import { Empty, Spinner } from '../../components/ui.jsx'
import { watchAllTenants, watchActivity } from '../../lib/platform.js'
import { ActivityRow, KINDS } from './shared.jsx'

export default function Activity() {
  const [tenants, setTenants] = useState([])
  const [rows, setRows] = useState(null)
  const [tenantId, setTenantId] = useState('')
  const [kind, setKind] = useState('')
  const [sev, setSev] = useState('')

  useEffect(() => watchAllTenants(setTenants), [])
  useEffect(
    () => watchActivity(setRows, { tenantId: tenantId || null, max: 250 }),
    [tenantId],
  )

  const filtered = useMemo(() => {
    let list = rows || []
    if (kind) list = list.filter((a) => a.kind === kind)
    if (sev) list = list.filter((a) => (a.severity || 'info') === sev)
    return list
  }, [rows, kind, sev])

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)' }}>
      <div>
        <h2 className="page-title">سجل النشاط الشامل</h2>
        <p className="muted small">كل إجراء وتحديث وخطوة تقوم بها أي منشأة — مباشر</p>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 'auto', flex: '1 1 160px' }} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
          <option value="">كل المنشآت</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name || t.slug}</option>)}
        </select>
        <select className="input" style={{ width: 'auto', flex: '1 1 130px' }} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">كل الأنواع</option>
          {Object.entries(KINDS).map(([id, k]) => <option key={id} value={id}>{k.label}</option>)}
        </select>
        <select className="input" style={{ width: 'auto', flex: '1 1 120px' }} value={sev} onChange={(e) => setSev(e.target.value)}>
          <option value="">كل الأهمية</option>
          <option value="high">هام</option>
          <option value="warn">تنبيه</option>
          <option value="info">عادي</option>
        </select>
      </div>

      {rows === null ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <Empty icon="bell" title="لا نشاط مطابق" hint="غيّر الفلاتر أو انتظر — كل حدث جديد يظهر لحظياً" />
      ) : (
        <div className="card card-pad">
          <div className="divide">
            {filtered.map((a) => <ActivityRow key={a.id} a={a} />)}
          </div>
        </div>
      )}
    </div>
  )
}
