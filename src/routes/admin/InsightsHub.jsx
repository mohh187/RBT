import SectionHub from '../../components/SectionHub.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { CAP } from '../../lib/permissions.js'
import PlanGate from '../../components/PlanGate.jsx'
import Dashboard from './Dashboard.jsx'
import Reports from './Reports.jsx'
import DailyReport from './DailyReport.jsx'

// "لوحة القيادة" — overview + reports + daily, as sub-tabs.
// Reports/Daily are an Enterprise feature; gate them here too (the standalone
// /admin/reports & /admin/daily routes are gated, but these tabs are reachable
// from the default /admin home which is not).
export default function InsightsHub() {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  return <SectionHub tabs={[
    { id: 'overview', icon: 'home', label: ar ? 'نظرة عامة' : 'Overview', render: () => <Dashboard /> },
    { id: 'reports', icon: 'reports', label: ar ? 'التقارير' : 'Reports', cap: CAP.VIEW_REPORTS, render: () => <PlanGate feature="reports"><Reports /></PlanGate> },
    { id: 'daily', icon: 'calendar', label: ar ? 'التقرير اليومي' : 'Daily', cap: CAP.VIEW_REPORTS, render: () => <PlanGate feature="reports"><DailyReport /></PlanGate> },
  ]} />
}
