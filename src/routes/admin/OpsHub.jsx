import SectionHub from '../../components/SectionHub.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { CAP } from '../../lib/permissions.js'
import Tables from './Tables.jsx'
import Reservations from './Reservations.jsx'
import Events from './Events.jsx'
import Inventory from './Inventory.jsx'

// "العمليات" — tables + reservations + events + inventory, as sub-tabs.
export default function OpsHub() {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  return <SectionHub tabs={[
    { id: 'tables', icon: 'tables', label: ar ? 'الطاولات' : 'Tables', cap: CAP.MANAGE_TABLES, render: () => <Tables /> },
    { id: 'inventory', icon: 'inventory', label: ar ? 'المخزون' : 'Inventory', cap: CAP.MANAGE_MENU, render: () => <Inventory /> },
    { id: 'reservations', icon: 'reservations', label: ar ? 'الحجوزات' : 'Reservations', cap: CAP.MANAGE_EVENTS, render: () => <Reservations /> },
    { id: 'events', icon: 'events', label: ar ? 'الفعاليات' : 'Events', cap: CAP.MANAGE_EVENTS, render: () => <Events /> },
  ]} />
}
