import { useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import Icon from '../../components/Icon.jsx'
import { updateTenant, healStaffCapsMirrors } from '../../lib/db.js'
import { CAP_LABELS, EDITABLE_ROLES, ROLE_CAPS, roleName } from '../../lib/permissions.js'

// Manager-configurable: which pages/features each role can see & do.
export default function Roles() {
  const { t, lang } = useI18n()
  const { tenantId, tenant, updateTenantLocal } = useAuth()
  const toast = useToast()
  const ar = lang === 'ar'
  const [draft, setDraft] = useState(() => {
    const base = {}
    EDITABLE_ROLES.forEach((r) => { base[r] = new Set(tenant?.roleCaps?.[r] || ROLE_CAPS[r]) })
    return base
  })
  const [busy, setBusy] = useState(false)
  const ALL_CAPS = Object.keys(CAP_LABELS)

  const roleLabel = (r) => roleName(r, lang)
  const toggle = (role, cap) => setDraft((d) => {
    const next = { ...d, [role]: new Set(d[role]) }
    if (next[role].has(cap)) next[role].delete(cap); else next[role].add(cap)
    return next
  })
  const save = async () => {
    setBusy(true)
    try {
      const roleCaps = {}
      EDITABLE_ROLES.forEach((r) => { roleCaps[r] = [...draft[r]] })
      await updateTenant(tenantId, { roleCaps })
      updateTenantLocal({ roleCaps })
      // Push the new role defaults into every staffer's rules-enforced caps mirror
      // right away (custom per-person overrides are preserved).
      healStaffCapsMirrors(tenantId, roleCaps).catch(() => {})
      toast.success(t('saved'))
    } catch (_) {
      toast.error(t('error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page stack">
      <h2 className="page-title row" style={{ gap: 8 }}><Icon name="staff" size={22} /> {ar ? 'الأدوار والصلاحيات' : 'Roles & permissions'}</h2>
      <p className="muted small">{ar ? 'حدّد ما يستطيع كل دور رؤيته وفعله، يتحكّم بالصفحات والمميزات الظاهرة له. (المالك والمدير: كل الصلاحيات.)' : 'Choose what each role can see & do, controls their visible pages and features. (Owner & manager: all.)'}</p>

      {/* Every role was expanded at once: ~200 identical 31px rows, 8.8 screens
          tall, with the only save button at the very bottom — changing one
          permission meant scrolling ~7400px down and then all the way back.
          One role open at a time, and the save button follows you. */}
      {EDITABLE_ROLES.map((role) => (
        <details key={role} className="card card-pad stack" style={{ gap: 6 }}>
          <summary className="row" style={{ gap: 6, cursor: 'pointer', listStyle: 'none', minHeight: 40, alignItems: 'center' }}>
            <Icon name="user" size={16} />
            <strong>{roleLabel(role)}</strong>
            <span className="xs faint">· {draft[role].size} {ar ? 'صلاحية' : 'caps'}</span>
            <span className="grow" />
            <Icon name="chevronDown" size={16} className="faint" />
          </summary>
          <div className="stack" style={{ gap: 2, marginTop: 'var(--sp-2)' }}>
            {ALL_CAPS.map((cap) => (
              <label key={cap} className="row-between" style={{ cursor: 'pointer', padding: '9px 0', minHeight: 40, borderTop: '1px solid var(--border)' }}>
                <span className="small">{ar ? CAP_LABELS[cap].ar : CAP_LABELS[cap].en}</span>
                <input type="checkbox" checked={draft[role].has(cap)} onChange={() => toggle(role, cap)} style={{ width: 22, height: 22, accentColor: 'var(--brand)' }} />
              </label>
            ))}
          </div>
        </details>
      ))}

      <div className="roles-save">
        <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>{busy ? t('saving') : t('save')}</button>
      </div>
    </div>
  )
}
