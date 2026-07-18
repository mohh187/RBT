import SectionHub from '../../components/SectionHub.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { CAP } from '../../lib/permissions.js'
import Customers from './Customers.jsx'
import Complaints from './Complaints.jsx'

// "العملاء" — customers directory + complaints, as sub-tabs.
export default function CustomersHub() {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  return <SectionHub tabs={[
    { id: 'customers', icon: 'customers', label: ar ? 'العملاء' : 'Customers', cap: CAP.VIEW_CUSTOMERS, render: () => <Customers /> },
    { id: 'complaints', icon: 'complaint', label: ar ? 'الشكاوى' : 'Complaints', cap: CAP.VIEW_COMPLAINTS, render: () => <Complaints /> },
  ]} />
}
