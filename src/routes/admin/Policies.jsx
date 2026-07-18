import { useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import Icon from '../../components/Icon.jsx'
import { updateTenant } from '../../lib/db.js'

// General venue policies — attendance/lateness, status (break/busy) limits & alerts,
// and leave. All consumed live by the portal & notification engine.
export default function Policies() {
  const { t, lang } = useI18n()
  const { tenantId, tenant, updateTenantLocal } = useAuth()
  const toast = useToast()
  const ar = lang === 'ar'
  const [grace, setGrace] = useState(tenant?.attendancePolicy?.graceMinutes ?? 15)
  const [rate, setRate] = useState(tenant?.attendancePolicy?.lateDeductionPerHour ?? 0)
  const [breakLimit, setBreakLimit] = useState(tenant?.statusPolicy?.breakLimitMinutes ?? 30)
  const [busyLimit, setBusyLimit] = useState(tenant?.statusPolicy?.busyLimitMinutes ?? 60)
  const [breaksPerDay, setBreaksPerDay] = useState(tenant?.statusPolicy?.breaksPerDay ?? 2)
  const [annualLeave, setAnnualLeave] = useState(tenant?.leavePolicy?.annualDays ?? 21)
  const [otAfter, setOtAfter] = useState(tenant?.overtimePolicy?.afterHours ?? 8)
  const [otRate, setOtRate] = useState(tenant?.overtimePolicy?.ratePerHour ?? 0)
  const [targetBonus, setTargetBonus] = useState(tenant?.rewardPolicy?.monthlyTargetBonus ?? 0)
  const [busySaving, setBusySaving] = useState(false)

  const save = async () => {
    setBusySaving(true)
    try {
      const patch = {
        attendancePolicy: { graceMinutes: Number(grace) || 0, lateDeductionPerHour: Number(rate) || 0 },
        statusPolicy: { breakLimitMinutes: Number(breakLimit) || 0, busyLimitMinutes: Number(busyLimit) || 0, breaksPerDay: Number(breaksPerDay) || 0 },
        leavePolicy: { annualDays: Number(annualLeave) || 0 },
        overtimePolicy: { afterHours: Number(otAfter) || 0, ratePerHour: Number(otRate) || 0 },
        rewardPolicy: { monthlyTargetBonus: Number(targetBonus) || 0 },
      }
      await updateTenant(tenantId, patch)
      updateTenantLocal(patch)
      toast.success(t('saved'))
    } catch (_) {
      toast.error(t('error'))
    } finally {
      setBusySaving(false)
    }
  }

  return (
    <div className="page stack">
      <h2 className="page-title row" style={{ gap: 8 }}><Icon name="clock" size={22} /> {ar ? 'السياسات العامة' : 'General policies'}</h2>

      {/* attendance / lateness */}
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <strong className="row" style={{ gap: 6 }}><Icon name="clock" size={16} /> {ar ? 'الحضور والتأخير' : 'Attendance & lateness'}</strong>
        <div className="row" style={{ gap: 8 }}>
          <div className="field grow"><label>{ar ? 'سماح التأخير (د)' : 'Grace (min)'}</label><input className="input num" type="number" value={grace} onChange={(e) => setGrace(e.target.value)} /></div>
          <div className="field grow"><label>{ar ? 'خصم التأخير/ساعة' : 'Late deduction/hr'}</label><input className="input num" type="number" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
        </div>
        <p className="xs faint">{ar ? 'يُحسب التأخير من البصمة مقارنةً بدوام الموظف ويومه (أيام إجازته لا تُحتسب)، ويُطبّق الخصم تلقائياً.' : 'Lateness is computed from clock-in vs the staffer’s shift & work day (off days excluded); deduction applies automatically.'}</p>
      </div>

      {/* status: break / busy limits + alerts */}
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <strong className="row" style={{ gap: 6 }}><Icon name="clock" size={16} style={{ color: 'var(--gold)' }} /> {ar ? 'الاستراحة والانشغال' : 'Breaks & busy'}</strong>
        <div className="row" style={{ gap: 8 }}>
          <div className="field grow"><label>{ar ? 'مدة الاستراحة (د)' : 'Break limit (min)'}</label><input className="input num" type="number" value={breakLimit} onChange={(e) => setBreakLimit(e.target.value)} /></div>
          <div className="field grow"><label>{ar ? 'مدة الانشغال (د)' : 'Busy limit (min)'}</label><input className="input num" type="number" value={busyLimit} onChange={(e) => setBusyLimit(e.target.value)} /></div>
        </div>
        <div className="field"><label>{ar ? 'عدد الاستراحات المسموح/يوم' : 'Allowed breaks / day'}</label><input className="input num" type="number" value={breaksPerDay} onChange={(e) => setBreaksPerDay(e.target.value)} /></div>
        <p className="xs faint">{ar ? 'عند تجاوز المدة المسموحة يصل تنبيه صوتي للموظف وإشعار فوري للمدير تلقائياً.' : 'When a staffer exceeds the allowed time, they get a sound alert and the manager gets an instant notification.'}</p>
      </div>

      {/* overtime */}
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <strong className="row" style={{ gap: 6 }}><Icon name="clock" size={16} style={{ color: 'var(--success)' }} /> {ar ? 'العمل الإضافي (أوفر تايم)' : 'Overtime'}</strong>
        <div className="row" style={{ gap: 8 }}>
          <div className="field grow"><label>{ar ? 'يبدأ بعد (ساعة/يوم)' : 'Starts after (h/day)'}</label><input className="input num" type="number" value={otAfter} onChange={(e) => setOtAfter(e.target.value)} /></div>
          <div className="field grow"><label>{ar ? 'أجر الساعة الإضافية' : 'Overtime rate/hr'}</label><input className="input num" type="number" value={otRate} onChange={(e) => setOtRate(e.target.value)} /></div>
        </div>
        <p className="xs faint">{ar ? 'كل ساعة عمل (من البصمة) تتجاوز الحد اليومي تُحتسب إضافية وتُضاف لراتب الموظف آلياً.' : 'Every clocked hour beyond the daily threshold is paid as overtime and added to the staffer’s pay automatically.'}</p>
      </div>

      {/* rewards */}
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <strong className="row" style={{ gap: 6 }}><Icon name="award" size={16} style={{ color: 'var(--gold)' }} /> {ar ? 'مكافأة تحقيق الهدف' : 'Target reward'}</strong>
        <div className="field"><label>{ar ? 'مكافأة عند تحقيق الهدف الشهري' : 'Bonus on hitting monthly target'}</label><input className="input num" type="number" value={targetBonus} onChange={(e) => setTargetBonus(e.target.value)} /></div>
        <p className="xs faint">{ar ? 'تُضاف للموظف الذي يحقّق هدف وظيفته الشهري وتظهر في كشف راتبه آلياً.' : 'Auto-added to any staffer who hits their monthly role target; shows in their payslip.'}</p>
      </div>

      {/* leave */}
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <strong className="row" style={{ gap: 6 }}><Icon name="calendar" size={16} /> {ar ? 'الإجازات' : 'Leave'}</strong>
        <div className="field"><label>{ar ? 'رصيد الإجازة السنوي (يوم)' : 'Annual leave (days)'}</label><input className="input num" type="number" value={annualLeave} onChange={(e) => setAnnualLeave(e.target.value)} /></div>
        <p className="xs faint">{ar ? 'يُعرض الرصيد المتبقّي لكل موظف في بوابته آلياً بعد خصم الإجازات المعتمدة.' : 'Each staffer sees their remaining balance in the portal after approved leave is deducted.'}</p>
      </div>

      <button className="btn btn-primary btn-block" disabled={busySaving} onClick={save}>{busySaving ? t('saving') : t('save')}</button>
      <p className="xs faint">{ar ? 'دوام كل موظف وأيام عمله تُحدَّد من بروفايله في «شؤون الموظفين».' : 'Each staffer’s shift & work days are set in their profile under Staff affairs.'}</p>
    </div>
  )
}
