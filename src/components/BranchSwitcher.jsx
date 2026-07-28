// The branch switcher.
//
// RENDERS NOTHING when the user has one venue or fewer — which is every
// account today. That single line is what makes shipping this invisible to
// existing users: their /admin chrome is byte-identical to before.
//
// Positioned as an OWNER tool. One account cannot be signed in to two branches
// on two devices at once (the active tenant is a single field), so staff who
// work one fixed branch should have their own account bound to it. The UI copy
// says so rather than selling something the model cannot do.
import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { useAuth } from '../lib/auth.jsx'
import { useToast } from './Toast.jsx'
import { watchMyMemberships, switchTenant, reloadIntoAdmin } from '../lib/branches.js'

export default function BranchSwitcher() {
  const { user, tenantId, tenant } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')

  useEffect(() => watchMyMemberships(user?.uid, setRows), [user?.uid])

  // The invisibility clause.
  if (!rows || rows.length <= 1) return null

  const go = async (tid) => {
    if (tid === tenantId) { setOpen(false); return }
    setBusy(tid)
    try {
      await switchTenant(tid)
      reloadIntoAdmin()
    } catch (e) {
      toast.error(e?.message || 'تعذّر التبديل')
      setBusy('')
    }
  }

  const current = rows.find((r) => r.tenantId === tenantId)

  return (
    <div className="brsw">
      <button className="brsw-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="store" size={14} />
        <span className="brsw-label">{current?.branchLabel || current?.tenantName || tenant?.name || 'الفرع'}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={13} />
      </button>
      {open && (
        <>
          <button className="brsw-scrim" onClick={() => setOpen(false)} aria-label="إغلاق" />
          <div className="brsw-menu">
            <span className="brsw-head">الفروع</span>
            {rows.map((r) => (
              <button
                key={r.tenantId}
                className={`brsw-item ${r.tenantId === tenantId ? 'is-on' : ''}`}
                disabled={!!busy}
                onClick={() => go(r.tenantId)}
              >
                <Icon name={r.tenantId === tenantId ? 'ok' : 'store'} size={14} />
                <span className="grow">{r.branchLabel || r.tenantName || r.tenantId}</span>
                {busy === r.tenantId ? <span className="xs faint">جارٍ…</span> : null}
              </button>
            ))}
            <span className="brsw-note">التبديل يعيد تحميل اللوحة على الفرع المختار.</span>
          </div>
        </>
      )}
    </div>
  )
}
