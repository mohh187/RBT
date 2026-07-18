import { Link } from 'react-router-dom'
import SectionHub from '../../components/SectionHub.jsx'
import Icon from '../../components/Icon.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { CAP } from '../../lib/permissions.js'
import Items from './Items.jsx'
import Categories from './Categories.jsx'
import Offers from './Offers.jsx'

// "المنيو" — items + categories + offers, as sub-tabs.
export default function MenuHub() {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  return (
    <>
      <div className="page no-print" style={{ paddingBottom: 0, display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <Link
          to="/admin/assistant"
          className="btn btn-sm btn-outline"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
          title={ar ? 'أرفق صورة منيو أو ملف إكسل وسيضيف المساعد الأصناف كاملة' : 'Attach a menu photo/Excel — the assistant imports everything'}
        >
          <Icon name="sparkles" size={14} />
          <span>{ar ? 'استيراد منيو بالذكاء' : 'AI menu import'}</span>
        </Link>
        <Link
          to="/admin/print-menu"
          className="btn btn-sm btn-outline"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
        >
          <Icon name="print" size={14} />
          <span>{ar ? 'تصدير PDF للطباعة' : 'Export print PDF'}</span>
        </Link>
      </div>
      <SectionHub tabs={[
        { id: 'items', icon: 'menu', label: ar ? 'الأصناف' : 'Items', cap: CAP.MANAGE_MENU, render: () => <Items /> },
        { id: 'categories', icon: 'categories', label: ar ? 'التصنيفات' : 'Categories', cap: CAP.MANAGE_MENU, render: () => <Categories /> },
        { id: 'offers', icon: 'offers', label: ar ? 'العروض' : 'Offers', cap: CAP.MANAGE_OFFERS, render: () => <Offers /> },
      ]} />
    </>
  )
}
