import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '../../lib/i18n.jsx'
import { useAuth } from '../../lib/auth.jsx'
import { CAP } from '../../lib/permissions.js'
import Icon from '../../components/Icon.jsx'
import Staff from './Staff.jsx'
import Performance from './Performance.jsx'
import Attendance from './Attendance.jsx'
import Leaves from './Leaves.jsx'
import Announcements from './Announcements.jsx'
import Schedule from './Schedule.jsx'
import Roles from './Roles.jsx'
import Policies from './Policies.jsx'

// Admin "Staff affairs" hub — tabs gated by capability (clock-in for everyone,
// members/performance for managers).
export default function StaffHub() {
  const { lang } = useI18n()
  const { can } = useAuth()
  const ar = lang === 'ar'

  const tabs = useMemo(() => [
    { id: 'members', icon: 'staff', label: ar ? 'الموظفون' : 'Members', cap: CAP.MANAGE_STAFF },
    { id: 'performance', icon: 'award', label: ar ? 'الأداء' : 'Performance', cap: CAP.VIEW_PERFORMANCE },
    { id: 'schedule', icon: 'calendar', label: ar ? 'الجدول' : 'Schedule', cap: CAP.MANAGE_STAFF },
    { id: 'attendance', icon: 'scan', label: ar ? 'الحضور والانصراف' : 'Attendance', cap: CAP.ATTENDANCE },
    { id: 'leaves', icon: 'calendar', label: ar ? 'الإجازات' : 'Leaves', cap: CAP.MANAGE_STAFF },
    { id: 'announcements', icon: 'bell', label: ar ? 'الإعلانات' : 'Announcements', cap: CAP.MANAGE_STAFF },
    { id: 'roles', icon: 'staff', label: ar ? 'الأدوار' : 'Roles', cap: CAP.MANAGE_STAFF },
    { id: 'policies', icon: 'clock', label: ar ? 'السياسات' : 'Policies', cap: CAP.MANAGE_SETTINGS },
  ].filter((tb) => can(tb.cap)), [ar, can])

  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState(tabs[0]?.id || 'attendance')
  // Deep-link: ?tab=leaves&focus=<id> (or &staff=<uid>) jumps to the exact place.
  const focus = params.get('focus') || ''
  const staffFocus = params.get('staff') || ''
  useEffect(() => {
    const want = params.get('tab')
    if (want && tabs.find((tb) => tb.id === want)) setTab(want)
  }, [params]) // eslint-disable-line react-hooks/exhaustive-deps
  const clearFocus = () => { const p = new URLSearchParams(params); p.delete('focus'); p.delete('staff'); setParams(p, { replace: true }) }

  const active = tabs.find((tb) => tb.id === tab) ? tab : tabs[0]?.id

  return (
    <>
      {tabs.length > 1 && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <div className="row" style={{ gap: 8, overflowX: 'auto', paddingBottom: 'var(--sp-2)' }}>
            {tabs.map((tb) => (
              <button key={tb.id} className={`chip ${active === tb.id ? 'active' : ''}`} style={{ flex: 'none' }} onClick={() => setTab(tb.id)}>
                <Icon name={tb.icon} size={15} /> {tb.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {active === 'members' && <Staff staffFocus={staffFocus} onFocusHandled={clearFocus} />}
      {active === 'performance' && <Performance />}
      {active === 'schedule' && <Schedule />}
      {active === 'attendance' && <Attendance />}
      {active === 'leaves' && <Leaves focusId={focus} onFocusHandled={clearFocus} />}
      {active === 'announcements' && <Announcements />}
      {active === 'roles' && <Roles />}
      {active === 'policies' && <Policies />}
    </>
  )
}
