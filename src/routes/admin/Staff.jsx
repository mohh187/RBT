import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import Sheet from '../../components/Sheet.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { Price } from '../../components/Riyal.jsx'
import { watchInvites, createInvite, deleteInvite, watchStaff, watchOrdersSince, watchAllReviews, setStaffMeta } from '../../lib/db.js'
import { createStaffAccount } from '../../lib/staffAuth.js'
import { nextStaffId } from '../../lib/format.js'
import { scoreStaff } from '../../lib/perf.js'
import { buildRoleTargets, buildRoleWeights } from '../../lib/targets.js'
import { ASSIGNABLE_ROLES, roleName, CAP } from '../../lib/permissions.js'
import Icon from '../../components/Icon.jsx'
import StaffProfile from './StaffProfile.jsx'
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

export default function Staff({ staffFocus, onFocusHandled }) {
  const { t, lang } = useI18n()
  const { tenantId, tenant, user, profile, isManager, can } = useAuth()
  const showMoney = can(CAP.VIEW_REVENUE) // colleagues' revenue hidden without it
  const toast = useToast()
  const currency = tenant?.currency || 'SAR'
  const [invites, setInvites] = useState(null)
  const [members, setMembers] = useState([])
  const [orders, setOrders] = useState([])
  const [reviews, setReviews] = useState([])
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('cashier')
  const [busy, setBusy] = useState(false)
  const [profileFor, setProfileFor] = useState(null)
  const dailyTarget = tenant?.staffTargets?.daily || 0

  const assigningId = useRef(new Set())

  useEffect(() => { if (!tenantId) return; return watchInvites(tenantId, setInvites) }, [tenantId])
  useEffect(() => { if (!tenantId) return; return watchStaff(tenantId, setMembers) }, [tenantId])
  useEffect(() => { if (!tenantId) return; return watchOrdersSince(tenantId, startOfToday(), setOrders) }, [tenantId])
  useEffect(() => { if (!tenantId) return; return watchAllReviews(tenantId, setReviews, 400) }, [tenantId])

  // Auto-assign a sequential venue staff ID (e.g. NEE001) to any member missing one.
  useEffect(() => {
    if (!isManager || !tenantId || !members.length) return
    const missing = members.filter((m) => !m.staffId && !assigningId.current.has(m.uid))
    if (!missing.length) return
    const taken = []
    missing.forEach((m) => {
      const id = nextStaffId(tenant, members, taken)
      taken.push(id)
      assigningId.current.add(m.uid)
      setStaffMeta(tenantId, m.uid, { staffId: id }).catch(() => assigningId.current.delete(m.uid))
    })
  }, [members, tenantId, isManager, tenant])

  const roleLabel = (r) => roleName(r, lang)

  // Today's performance per staffer (shared scorer — identical to the Performance tab).
  const rows = useMemo(() => scoreStaff(members, orders, reviews, { period: 'today', target: dailyTarget, roleTargets: buildRoleTargets(tenant, 'today'), roleWeights: buildRoleWeights(tenant), ar: lang === 'ar' }), [members, orders, reviews, dailyTarget, lang, tenant])

  // Deep-link: open a specific staffer's profile when arriving from a notification.
  useEffect(() => {
    if (!staffFocus || !rows.length) return
    const r = rows.find((x) => x.uid === staffFocus)
    if (r) { setProfileFor(r); onFocusHandled && onFocusHandled() }
  }, [staffFocus, rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const addStaff = async () => {
    if (!name.trim()) { toast.error(lang === 'ar' ? 'أدخل اسم الموظف' : 'Enter the name'); return }
    if (!email.trim()) { toast.error(lang === 'ar' ? 'أدخل البريد' : 'Enter the email'); return }
    if ((password || '').length < 6) { toast.error(lang === 'ar' ? 'كلمة المرور 6 أحرف على الأقل' : 'Password is at least 6 chars'); return }
    setBusy(true)
    try {
      // Create the login account (without disturbing the admin's session) + bind to this venue on first login.
      await createStaffAccount({ email: email.trim(), password, displayName: name.trim() })
      await createInvite(email.trim(), { tenantId, role, venueName: tenant?.name, invitedBy: profile?.email, name: name.trim() })
      setName(''); setEmail(''); setPassword(''); setOpen(false)
      toast.success(lang === 'ar' ? 'تم إنشاء حساب الموظف' : 'Staff account created')
    } catch (e) {
      const code = e?.code || ''
      toast.error(
        code === 'auth/email-already-in-use' ? (lang === 'ar' ? 'البريد مستخدم مسبقاً' : 'Email already in use')
          : code === 'auth/invalid-email' ? (lang === 'ar' ? 'بريد غير صحيح' : 'Invalid email')
          : code === 'auth/weak-password' ? (lang === 'ar' ? 'كلمة المرور ضعيفة' : 'Weak password')
          : t('error'),
      )
    } finally {
      setBusy(false)
    }
  }

  if (invites === null) return <Spinner />

  return (
    <div className="page stack">
      <div className="row-between">
        <h2 className="page-title">{t('staff')}</h2>
        {isManager && <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>+ {lang === 'ar' ? 'موظف' : 'Staff'}</button>}
      </div>

      {/* members + today's performance (this venue only) */}
      <div className="stack">
        <strong className="small muted">{lang === 'ar' ? 'الأعضاء · أداء اليوم' : 'Members · today'}</strong>
        {rows.length === 0 ? (
          <Empty icon="staff" title={lang === 'ar' ? 'لا أعضاء بعد' : 'No members yet'} hint={lang === 'ar' ? 'يظهر الموظفون هنا عند تسجيل دخولهم.' : 'Staff appear here once they sign in.'} />
        ) : (
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {rows.map((r) => {
              const isYou = r.uid === user?.uid
              return (
                <div key={r.uid} className="card card-pad stack" style={{ gap: 8, cursor: 'pointer' }} onClick={() => setProfileFor(r)}>
                  <div className="row" style={{ gap: 10 }}>
                    <div className="center" style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)', fontWeight: 800, flex: 'none' }}>
                      {(r.name || r.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="grow">
                      <div className="bold row" style={{ gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: r.status === 'busy' ? 'var(--danger)' : r.status === 'break' ? 'var(--gold)' : 'var(--success)' }} title={r.status || 'available'} />
                        {r.name || r.email}{isYou ? ` · ${lang === 'ar' ? 'أنت' : 'You'}` : ''}
                      </div>
                      <div className="xs faint row" style={{ gap: 6 }} dir="ltr">
                        {r.staffId && <span className="mono" style={{ fontWeight: 700, color: 'var(--brand)' }}>{r.staffId}</span>}
                        <span>{r.email}</span>
                      </div>
                    </div>
                    <span className="badge badge-gold">{roleLabel(r.role)}</span>
                    <Icon name={lang === 'ar' ? 'back' : 'next'} size={16} className="faint" />
                  </div>
                  <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="small row" style={{ gap: 4 }}><Icon name="orders" size={14} className="faint" /> {lang === 'ar' ? 'استلم' : 'Took'}: <strong>{r.handled}</strong></span>
                    <span className="small row" style={{ gap: 4 }}><Icon name="check" size={14} className="faint" /> {lang === 'ar' ? 'قدّم' : 'Served'}: <strong>{r.served}</strong></span>
                    <span className="small row" style={{ gap: 4 }}><Icon name="customers" size={14} className="faint" /> {lang === 'ar' ? 'عملاء' : 'Guests'}: <strong>{r.custCount}</strong></span>
                    <span className="grow" />
                    <span className="price small">{showMoney ? <Price value={r.revenue} currency={currency} lang={lang} /> : <span className="faint">—</span>}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* pending invites */}
      <div className="stack">
        <strong className="small muted">{lang === 'ar' ? 'دعوات معلّقة' : 'Pending invites'}</strong>
        {invites.length === 0 ? (
          <Empty icon="mail" title={lang === 'ar' ? 'لا دعوات معلّقة' : 'No pending invites'} />
        ) : (
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {invites.map((inv) => (
              <div key={inv.email} className="list-row">
                <Icon name="mail" size={20} />
                <div className="grow">
                  <div className="bold small" dir="ltr">{inv.email}</div>
                  <div className="xs faint">{roleLabel(inv.role)}</div>
                </div>
                {isManager && <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => deleteInvite(inv.email)}><Icon name="delete" size={18} /></button>}
              </div>
            ))}
          </div>
        )}
        <p className="xs faint">
          {lang === 'ar'
            ? 'الموظف المدعوّ ينضم لمنشأتك تلقائياً عند تسجيل الدخول بنفس البريد — ولا يرى أو يصل إلا بيانات منشأتك.'
            : 'Invited staff auto-join your venue on first login — and can only ever see/act on your venue’s data.'}
        </p>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={lang === 'ar' ? 'إضافة موظف' : 'Add staff'}
        footer={<button className="btn btn-primary btn-block" disabled={busy} onClick={addStaff}>{busy ? t('saving') : (lang === 'ar' ? 'إنشاء الحساب' : 'Create account')}</button>}>
        <div className="stack">
          <div className="field">
            <label>{lang === 'ar' ? 'الاسم' : 'Name'}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={lang === 'ar' ? 'اسم الموظف' : 'Staff name'} />
          </div>
          <div className="field">
            <label>{t('email')}</label>
            <input className="input" dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@email.com" />
          </div>
          <div className="field">
            <label>{lang === 'ar' ? 'كلمة المرور' : 'Password'}</label>
            <input className="input" dir="ltr" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={lang === 'ar' ? '6 أحرف على الأقل' : 'At least 6 chars'} />
          </div>
          <div className="field">
            <label>{t('role')}</label>
            <div className="row wrap" style={{ gap: 8 }}>
              {ASSIGNABLE_ROLES.map((r) => (
                <button key={r} className={`chip ${role === r ? 'active' : ''}`} onClick={() => setRole(r)}>{roleLabel(r)}</button>
              ))}
            </div>
          </div>
          <p className="xs faint">{lang === 'ar' ? 'يسجّل الموظف الدخول بهذا البريد وكلمة المرور، وينضم لمنشأتك تلقائياً بالدور المحدّد.' : 'The staffer logs in with this email & password and auto-joins your venue with the selected role.'}</p>
        </div>
      </Sheet>

      {profileFor && (
        <StaffProfile key={profileFor.uid} tid={tenantId} row={profileFor} target={dailyTarget} currency={currency}
          reviews={reviews.filter((r) => r.staffUid === profileFor.uid)}
          onClose={() => setProfileFor(null)} />
      )}
    </div>
  )
}
