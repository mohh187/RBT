import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import CashierPOS from '../../components/CashierPOS.jsx'
import { useSystemThemeBody } from '../../lib/systemThemes.js'

// Real cashier POS rendered standalone for the Settings live preview iframe.
// Read-only intent: it's the actual component, so themes/templates/backdrop
// match production exactly; auth watches the tenant doc → updates live.
// The body mirror is REQUIRED here: glassdark/aurora/custom-theme/button-style
// all ride on body attributes — without it the preview showed plain glass and
// «يتبع العام» looked broken.
export default function PosPreviewPage() {
  const { tenant, tenantId } = useAuth()
  const { lang } = useI18n()
  useSystemThemeBody(tenant, 'cashier')
  return <CashierPOS open onClose={() => {}} tenantId={tenantId} tenant={tenant} lang={lang} actorName="" />
}
