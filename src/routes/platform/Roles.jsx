// /platform/roles — list platform admins and (for super-admins) change their role.
import { useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { useAuth } from '../../lib/auth.jsx'
import { db, functions } from '../../lib/firebase.js'
import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { watchPlatformAdmins, logPlatformAction } from '../../lib/platformAudit.js'

const ROLES = [
  { id: 'superAdmin', ar: 'مشرف أعلى', badge: 'badge-danger' },
  { id: 'support', ar: 'دعم', badge: 'badge-info' },
  { id: 'analyst', ar: 'محلل', badge: 'badge-gold' },
]

function roleMeta(id) {
  return ROLES.find((r) => r.id === id) || { id: id || 'superAdmin', ar: id || 'مشرف أعلى', badge: 'badge' }
}

export default function Roles() {
  const { user } = useAuth()
  const toast = useToast()
  const [admins, setAdmins] = useState(null)
  const [myRole, setMyRole] = useState(undefined) // undefined = loading
  const [saving, setSaving] = useState(null) // uid currently being saved

  useEffect(() => watchPlatformAdmins(setAdmins), [])

  // Read our own platformAdmins doc; a missing `role` field means super-admin.
  useEffect(() => {
    let live = true
    if (!user?.uid) { setMyRole(null); return }
    getDoc(doc(db, 'platformAdmins', user.uid))
      .then((snap) => {
        if (!live) return
        setMyRole(snap.exists() ? (snap.data().role || 'superAdmin') : null)
      })
      .catch(() => live && setMyRole(null))
    return () => { live = false }
  }, [user?.uid])

  const isSuper = myRole === 'superAdmin'

  const sorted = useMemo(
    () => [...(admins || [])].sort((a, b) => (a.email || a.id).localeCompare(b.email || b.id)),
    [admins],
  )

  async function changeRole(admin, role) {
    if (!isSuper || role === (admin.role || 'superAdmin')) return
    setSaving(admin.id)
    try {
      const setPlatformRole = httpsCallable(functions, 'setPlatformRole')
      await setPlatformRole({ uid: admin.id, role })
      await logPlatformAction(user, {
        action: 'role.set',
        targetTid: admin.id,
        targetName: admin.email || admin.id,
        detail: `الدور: ${roleMeta(role).ar}`,
      })
      toast.success('تم تحديث الصلاحية')
    } catch (e) {
      toast.error(e?.message || 'تعذّر تغيير الصلاحية')
    } finally {
      setSaving(null)
    }
  }

  if (admins == null || myRole === undefined) return <div className="page"><Spinner /></div>

  return (
    <div className="page">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
        <h1 className="page-title">صلاحيات المشرفين</h1>
        <span className="muted small">{sorted.length} مشرف</span>
      </div>

      <div className="card card-pad" style={{ borderInlineStart: '3px solid var(--brand)' }}>
        <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <Icon name="key" size={18} />
          <div className="small muted">
            لإضافة مشرف جديد، أنشئ مستنداً في <span className="bold">platformAdmins/&#123;uid&#125;</span> من وحدة تحكّم Firebase.
            {isSuper ? ' يمكنك تغيير صلاحية أي مشرف من هنا.' : ' تغيير الصلاحيات متاح للمشرف الأعلى فقط.'}
          </div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <Empty icon="key" title="لا يوجد مشرفون" hint="أضف أول مشرف من وحدة تحكّم Firebase." />
      ) : (
        <div className="card divide">
          {sorted.map((admin) => {
            const meta = roleMeta(admin.role || 'superAdmin')
            const isMe = admin.id === user?.uid
            return (
              <div key={admin.id} className="list-row row-between" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                <div className="row grow" style={{ gap: 10, minWidth: 200 }}>
                  <Icon name="user" size={18} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="bold truncate">
                      {admin.email || admin.id}
                      {isMe ? <span className="xs faint"> (أنت)</span> : null}
                    </div>
                    <div className="xs faint num truncate">{admin.id}</div>
                  </div>
                </div>
                <div className="row" style={{ gap: 8, flex: 'none' }}>
                  {isSuper ? (
                    <select
                      className="select input-sm"
                      value={admin.role || 'superAdmin'}
                      disabled={saving === admin.id}
                      onChange={(e) => changeRole(admin, e.target.value)}
                    >
                      {ROLES.map((r) => (
                        <option key={r.id} value={r.id}>{r.ar}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`badge ${meta.badge}`}>{meta.ar}</span>
                  )}
                  {saving === admin.id ? <Spinner /> : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
